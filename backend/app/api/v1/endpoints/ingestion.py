import os
import hashlib
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.db.base import get_db
from app.models.all_models import DocumentMetadata
from app.schemas.document_schemas import UploadResponse, DocumentListResponse
from app.services.rag_service import process_document

router = APIRouter()

UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload", response_model=UploadResponse)
async def upload_document(
    file: UploadFile = File(...),
    module: str = Form(...),
    doc_type: str = Form("prd"),
    db: AsyncSession = Depends(get_db)
):
    """
    Upload a PRD or SOP document, process it, and ingest into Qdrant.
    """
    print(f"Received upload request: file={file.filename}, module={module}, doc_type={doc_type}")
    if not file.filename.endswith(('.md', '.txt')):
        raise HTTPException(status_code=400, detail="Currently only .md and .txt files are supported for MVP.")
    
    # Read content
    content = await file.read()
    text_content = content.decode('utf-8')
    print(f"File read successfully, size={len(text_content)} chars")
    
    # Calculate hash to prevent exact duplicates (simple version)
    content_hash = hashlib.md5(content).hexdigest()
    
    # Check if already exists
    result = await db.execute(
        select(DocumentMetadata).filter(DocumentMetadata.content_hash == content_hash)
    )
    existing_doc = result.scalars().first()
    if existing_doc:
        print(f"Duplicate document found: {file.filename}")
        return UploadResponse(
            message="Document already exists (skipped re-processing)",
            document_id=existing_doc.id,
            chunks_processed=0
        )

    # Save file locally
    file_path = os.path.join(UPLOAD_DIR, f"{content_hash}_{file.filename}")
    with open(file_path, "wb") as f:
        f.write(content)
    print(f"File saved locally to {file_path}")

    # Process and Ingest to Vector DB
    try:
        print("Starting process_document...")
        chunks_count = process_document(text_content, module, file.filename)
        print(f"process_document completed, chunks={chunks_count}")
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"Error in process_document: {e}")
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
    print("Metadata saved to DB")

    return UploadResponse(
        message="Document uploaded and processed successfully",
        document_id=new_doc.id,
        chunks_processed=chunks_count
    )

@router.get("/modules")
async def get_modules():
    """
    Get available business modules. (Mocked for MVP)
    """
    return {
        "modules": [
            "支付模块",
            "任务调度",
            "用户中心"
        ]
    }

@router.get("/history", response_model=DocumentListResponse)
async def get_upload_history(db: AsyncSession = Depends(get_db)):
    """
    Get history of uploaded documents.
    """
    result = await db.execute(
        select(DocumentMetadata).order_by(DocumentMetadata.upload_time.desc())
    )
    documents = result.scalars().all()
    return {"documents": documents}

@router.get("/document/{doc_id}")
async def get_document_content(doc_id: int, db: AsyncSession = Depends(get_db)):
    """
    Get document content by ID.
    """
    result = await db.execute(
        select(DocumentMetadata).filter(DocumentMetadata.id == doc_id)
    )
    document = result.scalars().first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
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
async def delete_document(doc_id: int, db: AsyncSession = Depends(get_db)):
    """
    Delete a document by ID.
    """
    result = await db.execute(
        select(DocumentMetadata).filter(DocumentMetadata.id == doc_id)
    )
    document = result.scalars().first()
    
    if not document:
        raise HTTPException(status_code=404, detail="Document not found")
    
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
