import time
import json
import os
import hashlib
import re
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select

from app.db.base import get_db
from app.models.all_models import ReviewTask, ConflictCard, DocumentMetadata
from app.schemas.review_schemas import ReviewRequest, ReviewResponse, DocBlockItem, ConflictItem, SupplementaryInfoItem
from app.services.rag_service import search_similar_documents, process_document
from app.services.llm_service import analyze_conflicts

router = APIRouter()
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)

def _extract_requirement_title(content: str) -> str:
    lines = content.splitlines()
    for line in lines:
        m = re.match(r"^\s{0,3}#{1,6}\s+(.+?)\s*$", line)
        if m and m.group(1).strip():
            return m.group(1).strip()
    for line in lines:
        m = re.match(r"^\s*(?:需求标题|标题)\s*[：:]\s*(.+?)\s*$", line)
        if m and m.group(1).strip():
            return m.group(1).strip()
    for line in lines:
        s = line.strip()
        if s:
            return s
    return "未命名需求"

def _sanitize_filename_title(title: str) -> str:
    cleaned = re.sub(r'[\\/:*?"<>|\r\n\t]', " ", title).strip()
    cleaned = re.sub(r"\s+", " ", cleaned).strip(" .")
    return cleaned or "未命名需求"

@router.post("/analyze", response_model=ReviewResponse)
async def analyze_requirement(
    request: ReviewRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Submit a new requirement for RAG-based review.
    1. Retrieve similar historical docs/SOPs.
    2. Pass to LLM for conflict analysis.
    3. Save task state to DB.
    """
    start_time = time.time()
    
    try:
        # Step 1: Retrieval (Recall)
        # Search Qdrant for similar context within the same module
        retrieved_docs = search_similar_documents(
            query=request.content,
            module=request.module,
            limit=5
        )
        
        print(f"DEBUG: Retrieved {len(retrieved_docs)} historical documents for module '{request.module}'")
        for i, doc in enumerate(retrieved_docs):
            print(f"  Doc {i+1}: {doc.get('filename')} (Score: {doc.get('score'):.4f})")
            # print(f"    Content: {doc.get('content')[:100]}...")
        
        if not retrieved_docs:
            print(f"WARNING: No historical context found for module '{request.module}'. Analysis will proceed without context.")
        analysis_result = await analyze_conflicts(
            module=request.module,
            new_content=request.content,
            retrieved_docs=retrieved_docs
        )
        
        # Step 3: Save to Database
        # Save Task
        task = ReviewTask(
            module=request.module,
            origin_content=request.content,
            optimized_content=json.dumps(analysis_result.get("blocks", [])),
            status="completed"
        )
        db.add(task)
        await db.flush()  # To get task.id
        
        # Save Conflicts
        db_conflicts = []
        for c in analysis_result.get("conflicts", []):
            conflict_card = ConflictCard(
                task_id=task.id,
                conflict_type=c.get("type", "conflict"),
                description=c.get("description", ""),
                is_ignored=c.get("ignored", False)
            )
            db.add(conflict_card)
            db_conflicts.append(conflict_card)
            
        await db.commit()
        
        processing_time = time.time() - start_time
        
        # Map back to response schema
        blocks = [DocBlockItem(**b) for b in analysis_result.get("blocks", [])]
        conflicts = [ConflictItem(**c) for c in analysis_result.get("conflicts", [])]
        supp_info = [SupplementaryInfoItem(**s) for s in analysis_result.get("supplementaryInfo", [])]
        
        return ReviewResponse(
            task_id=task.id,
            module=request.module,
            blocks=blocks,
            conflicts=conflicts,
            supplementaryInfo=supp_info,
            processing_time_sec=round(processing_time, 2)
        )
        
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Review analysis failed: {str(e)}")

@router.post("/merge/{task_id}")
async def merge_confirmation(
    task_id: int,
    payload: dict = Body(...),
    db: AsyncSession = Depends(get_db)
):
    """
    Confirm the merge of the optimized content.
    Updates the task status and theoretically should trigger a re-ingestion 
    of the new final document into the knowledge base.
    """
    final_content = payload.get("finalContent") or payload.get("final_content")
    if not isinstance(final_content, str) or not final_content.strip():
        raise HTTPException(status_code=422, detail="finalContent is required")
    final_content = final_content.strip()

    try:
        task = await db.get(ReviewTask, task_id)
        if not task:
            raise HTTPException(status_code=404, detail="Task not found")

        task.status = "merged"
        task.optimized_content = final_content

        content_bytes = final_content.encode("utf-8")
        content_hash = hashlib.md5(content_bytes).hexdigest()
        existing_result = await db.execute(
            select(DocumentMetadata).filter(DocumentMetadata.content_hash == content_hash)
        )
        existing_doc = existing_result.scalars().first()
        if existing_doc:
            await db.commit()
            return {
                "message": "Merge confirmed and document already exists in knowledge base",
                "task_id": task_id,
                "document_id": existing_doc.id,
                "chunks_processed": 0
            }

        requirement_title = _extract_requirement_title(final_content)
        safe_title = _sanitize_filename_title(requirement_title)
        filename = f"{safe_title}.md"
        file_path = os.path.join(UPLOAD_DIR, f"{content_hash}_{filename}")
        with open(file_path, "wb") as f:
            f.write(content_bytes)

        chunks_count = 0
        indexing_error = None
        try:
            chunks_count = process_document(final_content, task.module, filename)
        except Exception as e:
            indexing_error = str(e)

        await db.execute(
            DocumentMetadata.__table__.update()
            .where(DocumentMetadata.module == task.module)
            .where(DocumentMetadata.doc_type == "prd")
            .values(is_latest=False)
        )

        new_doc = DocumentMetadata(
            filename=filename,
            module=task.module,
            doc_type="prd",
            content_hash=content_hash,
            file_path=file_path,
            is_latest=True
        )
        db.add(new_doc)
        await db.commit()
        await db.refresh(new_doc)

        if indexing_error:
            return {
                "message": "Merge confirmed, but knowledge base indexing failed",
                "task_id": task_id,
                "document_id": new_doc.id,
                "chunks_processed": chunks_count,
                "indexing_error": indexing_error
            }
        return {
            "message": "Merge confirmed and archived to knowledge base",
            "task_id": task_id,
            "document_id": new_doc.id,
            "chunks_processed": chunks_count
        }
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")
