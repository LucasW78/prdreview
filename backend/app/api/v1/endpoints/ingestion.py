import os
import hashlib
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func
from typing import Optional

from app.db.base import get_db
from app.models.all_models import DocumentMetadata
from app.schemas.document_schemas import UploadResponse, DocumentListResponse
from app.services.rag_service import process_document
from app.core.permissions import get_permission_context, ensure_module_access, PermissionContext

router = APIRouter()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    module: str = Form(...),
    doc_type: str = Form("prd"),
    db: AsyncSession = Depends(get_db),
    ctx: PermissionContext = Depends(get_permission_context)
):
    """
    Upload a PRD or SOP document, process it, and ingest into Qdrant.
    """
    ensure_module_access(ctx, module)
    if not file.filename.endswith(('.md', '.txt')):
        raise HTTPException(status_code=400, detail="Currently only .md and .txt files are supported for MVP.")
    
    # Read content
    content = await file.read()
    try:
        text_content = content.decode('utf-8')
    except UnicodeDecodeError:
        try:
            text_content = content.decode('utf-8-sig')
        except UnicodeDecodeError:
            raise HTTPException(status_code=422, detail="文件编码不受支持，请使用 UTF-8 编码后重试。")
    
    # Calculate hash to prevent exact duplicates (simple version)
    content_hash = hashlib.md5(content).hexdigest()
    
    # Check if already exists (same hash + same module + same doc_type)
    # NOTE: SOP/PRD can share content; dedupe must not跨类型误判
    result = await db.execute(
        select(DocumentMetadata)
        .where(DocumentMetadata.content_hash == content_hash)
        .where(DocumentMetadata.module == module)
        .where(DocumentMetadata.doc_type == doc_type)
    )
    existing_doc = result.scalars().first()
    if existing_doc:
        return UploadResponse(
            message="Document already exists (skipped re-processing)",
            document_id=existing_doc.id,
            chunks_processed=0
        )

    # Save file locally
    file_path = os.path.join(UPLOAD_DIR, f"{content_hash}_{file.filename}")
    with open(file_path, "wb") as f:
        f.write(content)
    # Process and Ingest to Vector DB
    try:
        chunks_count = process_document(text_content, module, file.filename, doc_type=doc_type)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to process document: {str(e)}")

    # Update old versions to not latest
    await db.execute(
        DocumentMetadata.__table__.update()
        .where(DocumentMetadata.module == module)
        .where(DocumentMetadata.doc_type == doc_type)
        .values(is_latest=False)
    )

    # Save Metadata to Postgres
    new_doc = DocumentMetadata(
        filename=file.filename,
        module=module,
        doc_type=doc_type,
        content_hash=content_hash,
        file_path=file_path,
        is_latest=True
    )
    db.add(new_doc)
    await db.commit()
    await db.refresh(new_doc)

    return UploadResponse(
        message="Document uploaded and processed successfully",
        document_id=new_doc.id,
        chunks_processed=chunks_count
    )

@router.get("/modules")
async def get_modules(ctx: PermissionContext = Depends(get_permission_context)):
    """
    Get available business modules. (Mocked for MVP)
    """
    modules = [
        "支付模块",
        "任务调度",
        "用户中心",
        "治理"
    ]
    if ctx.is_super_admin:
        return {"modules": modules}
    return {"modules": [m for m in modules if m in ctx.allowed_modules]}

@router.get("/history", response_model=DocumentListResponse)
async def get_upload_history(
    module: Optional[str] = Query(None),
    keyword: Optional[str] = Query(None),
    doc_type: Optional[str] = Query(None),
    page: int = Query(1, ge=1),
    db: AsyncSession = Depends(get_db),
    ctx: PermissionContext = Depends(get_permission_context)
):
    """
    Get history of uploaded documents.
    """
    stmt = select(DocumentMetadata)
    if ctx.is_super_admin:
        if module and module != "全部":
            stmt = stmt.where(DocumentMetadata.module == module)
    else:
        if module and module != "全部":
            ensure_module_access(ctx, module)
            stmt = stmt.where(DocumentMetadata.module == module)
        else:
            stmt = stmt.where(DocumentMetadata.module.in_(ctx.allowed_modules))
    if keyword:
        stmt = stmt.where(DocumentMetadata.filename.ilike(f"%{keyword}%"))
    if doc_type in {"prd", "sop"}:
        stmt = stmt.where(DocumentMetadata.doc_type == doc_type)
    stmt = stmt.order_by(DocumentMetadata.upload_time.desc())

    # Get total count
    count_result = await db.execute(select(func.count()).select_from(stmt.subquery()))
    total = count_result.scalar() or 0

    # Apply pagination
    page_size = 6
    offset = (page - 1) * page_size
    stmt = stmt.offset(offset).limit(page_size)

    result = await db.execute(stmt)
    documents = result.scalars().all()
    return {
        "documents": documents,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": (total + page_size - 1) // page_size if page_size > 0 else 1
    }

@router.get("/document/{doc_id}")
async def get_document_content(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: PermissionContext = Depends(get_permission_context)
):
    """
    Get document content by ID.
    """
    result = await db.execute(
        select(DocumentMetadata).filter(DocumentMetadata.id == doc_id)
    )
    document = result.scalars().first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if not ctx.is_super_admin:
        ensure_module_access(ctx, document.module)
    
    if not document.file_path or not os.path.exists(document.file_path):
        raise HTTPException(status_code=404, detail="Document file not found")
    
    try:
        with open(document.file_path, "r", encoding="utf-8") as f:
            content = f.read()
        return {
            "id": document.id,
            "filename": document.filename,
            "module": document.module,
            "doc_type": document.doc_type,
            "content": content,
            "upload_time": document.upload_time
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to read document: {str(e)}")

@router.delete("/document/{doc_id}")
async def delete_document(
    doc_id: int,
    db: AsyncSession = Depends(get_db),
    ctx: PermissionContext = Depends(get_permission_context)
):
    """
    Delete a document by ID.
    """
    result = await db.execute(
        select(DocumentMetadata).filter(DocumentMetadata.id == doc_id)
    )
    document = result.scalars().first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    if not ctx.is_super_admin:
        ensure_module_access(ctx, document.module)
    
    try:
        if document.file_path and os.path.exists(document.file_path):
            os.remove(document.file_path)
        
        await db.delete(document)
        await db.commit()
        
        return {
            "message": "Document deleted successfully",
            "document_id": doc_id
        }
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Failed to delete document: {str(e)}")
