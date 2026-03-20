import time
import json
from fastapi import APIRouter, Depends, HTTPException, Body
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.base import get_db
from app.models.all_models import ReviewTask, ConflictCard
from app.schemas.review_schemas import ReviewRequest, ReviewResponse, DocBlockItem, ConflictItem, SupplementaryInfoItem
from app.services.rag_service import search_similar_documents
from app.services.llm_service import analyze_conflicts

router = APIRouter()

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
    if not final_content or not isinstance(final_content, str):
        raise HTTPException(status_code=422, detail="finalContent is required")

    task = await db.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
        
    task.status = "merged"
    task.optimized_content = final_content
    await db.commit()
    
    # In a full implementation, we would call process_document() here 
    # to add this new final_content back into Qdrant as the latest truth.
    
    return {"message": "Merge confirmed successfully", "task_id": task_id}
