import time
import json
import os
import hashlib
import re
import asyncio
from datetime import datetime
from typing import List
from fastapi import APIRouter, Depends, HTTPException, Body, BackgroundTasks, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, func

from app.db.base import get_db, AsyncSessionLocal
from app.models.all_models import ReviewTask, ConflictCard, DocumentMetadata
from app.schemas.review_schemas import (
    ReviewRequest,
    ReviewSubmitResponse,
    ReviewTaskStatusResponse,
    ReviewTaskListResponse,
    ReviewSnapshotItem,
    SaveSnapshotRequest,
    DocBlockItem,
    ConflictItem,
    SupplementaryInfoItem,
)
from app.services.rag_service import search_similar_documents, process_document
from app.services.llm_service import analyze_conflicts, get_conflict_analysis_prompt, set_conflict_analysis_prompt
from app.core.permissions import ensure_super_admin

router = APIRouter(dependencies=[Depends(ensure_super_admin)])
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

def _truncate_utf8(text: str, max_bytes: int) -> str:
    if max_bytes <= 0:
        return ""
    out = []
    size = 0
    for ch in text:
        ch_bytes = len(ch.encode("utf-8"))
        if size + ch_bytes > max_bytes:
            break
        out.append(ch)
        size += ch_bytes
    return "".join(out)

def _to_snapshot_item(snapshot: dict, task: ReviewTask) -> ReviewSnapshotItem:
    return ReviewSnapshotItem(
        task_id=snapshot.get("task_id", task.id),
        module=snapshot.get("module", task.module),
        status=snapshot.get("status", task.status),
        processing_time_sec=snapshot.get("processing_time_sec"),
        blocks=[DocBlockItem(**b) for b in snapshot.get("blocks", [])],
        conflicts=[ConflictItem(**c) for c in snapshot.get("conflicts", [])],
        supplementaryInfo=[SupplementaryInfoItem(**i) for i in snapshot.get("supplementaryInfo", [])],
        created_at=snapshot.get("created_at")
    )

def _to_task_status_response(task: ReviewTask, include_snapshots: bool = True) -> ReviewTaskStatusResponse:
    snapshots_raw = task.snapshot_history or []
    snapshots = [_to_snapshot_item(s, task) for s in snapshots_raw] if include_snapshots else []
    result = _to_snapshot_item(task.result_snapshot, task) if task.result_snapshot else None
    document_name = _sanitize_filename_title(_extract_requirement_title(task.origin_content or ""))
    return ReviewTaskStatusResponse(
        task_id=task.id,
        module=task.module,
        status=task.status,
        origin_content=task.origin_content,
        document_name=document_name,
        processing_time_sec=task.processing_time_sec,
        error_message=task.error_message,
        snapshots_count=len(snapshots_raw),
        result=result,
        snapshots=snapshots
    )

async def _run_merge_index_async(task_id: int, final_content: str, module: str, filename: str, file_path: str, content_hash: str):
    async with AsyncSessionLocal() as db:
        try:
            chunks_count = await asyncio.to_thread(process_document, final_content, module, filename)
            await db.execute(
                DocumentMetadata.__table__.update()
                .where(DocumentMetadata.module == module)
                .where(DocumentMetadata.doc_type == "prd")
                .where(DocumentMetadata.content_hash != content_hash)
                .values(is_latest=False)
            )
            existing_result = await db.execute(
                select(DocumentMetadata).filter(DocumentMetadata.content_hash == content_hash)
            )
            existing_doc = existing_result.scalars().first()
            if not existing_doc:
                db.add(
                    DocumentMetadata(
                        filename=filename,
                        module=module,
                        doc_type="prd",
                        content_hash=content_hash,
                        file_path=file_path,
                        is_latest=True
                    )
                )
            task = await db.get(ReviewTask, task_id)
            if task:
                task.error_message = None
                task.updated_at = datetime.utcnow()
                task.processing_time_sec = float(chunks_count)
            await db.commit()
        except Exception as e:
            task = await db.get(ReviewTask, task_id)
            if task:
                task.error_message = f"merge_index_failed: {str(e)}"
                task.updated_at = datetime.utcnow()
                await db.commit()

async def _run_review_task_async(task_id: int, module: str, content: str):
    async with AsyncSessionLocal() as db:
        task = await db.get(ReviewTask, task_id)
        if not task:
            return
        task.status = "processing"
        task.error_message = None
        task.updated_at = datetime.utcnow()
        await db.commit()

        start_time = time.time()
        try:
            retrieved_docs = search_similar_documents(
                query=content,
                module=module,
                limit=5
            )

            analysis_result = await analyze_conflicts(
                module=module,
                new_content=content,
                retrieved_docs=retrieved_docs
            )

            processing_time = round(time.time() - start_time, 2)
            result_snapshot = {
                "task_id": task_id,
                "module": module,
                "status": "completed",
                "processing_time_sec": processing_time,
                "blocks": analysis_result.get("blocks", []),
                "conflicts": analysis_result.get("conflicts", []),
                "supplementaryInfo": analysis_result.get("supplementaryInfo", []),
                "created_at": datetime.utcnow().isoformat()
            }

            await db.execute(delete(ConflictCard).where(ConflictCard.task_id == task_id))
            for c in analysis_result.get("conflicts", []):
                db.add(
                    ConflictCard(
                        task_id=task_id,
                        conflict_type=c.get("type", "conflict"),
                        description=c.get("description", ""),
                        is_ignored=c.get("ignored", False)
                    )
                )

            task = await db.get(ReviewTask, task_id)
            if not task:
                return
            task.status = "completed"
            task.processing_time_sec = processing_time
            task.optimized_content = json.dumps(analysis_result.get("blocks", []))
            task.result_snapshot = result_snapshot
            task.error_message = None
            history = task.snapshot_history or []
            history.append(result_snapshot)
            task.snapshot_history = history
            task.updated_at = datetime.utcnow()
            await db.commit()
        except Exception as e:
            task = await db.get(ReviewTask, task_id)
            if task:
                task.status = "failed"
                task.error_message = str(e)
                task.updated_at = datetime.utcnow()
                await db.commit()

@router.post("/analyze", response_model=ReviewSubmitResponse)
async def analyze_requirement(
    request: ReviewRequest,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db)
):
    try:
        task = ReviewTask(
            module=request.module,
            origin_content=request.content,
            status="pending",
            snapshot_history=[]
        )
        db.add(task)
        await db.flush()
        await db.commit()

        background_tasks.add_task(_run_review_task_async, task.id, request.module, request.content)
        return ReviewSubmitResponse(
            task_id=task.id,
            module=request.module,
            status="pending"
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Review analysis failed: {str(e)}")

@router.get("/tasks/{task_id}", response_model=ReviewTaskStatusResponse)
async def get_review_task_status(
    task_id: int,
    db: AsyncSession = Depends(get_db)
):
    task = await db.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    return _to_task_status_response(task)

@router.get("/tasks", response_model=ReviewTaskListResponse)
async def list_review_tasks(
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    include_snapshots: bool = Query(False),
    db: AsyncSession = Depends(get_db)
):
    base_stmt = select(ReviewTask).where(ReviewTask.status != "merged")
    count_stmt = select(func.count()).select_from(base_stmt.subquery())
    count_result = await db.execute(count_stmt)
    total = count_result.scalar() or 0

    stmt = (
        base_stmt
        .order_by(ReviewTask.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(stmt)
    tasks = result.scalars().all()
    total_pages = (total + page_size - 1) // page_size if page_size > 0 else 1
    return ReviewTaskListResponse(
        tasks=[_to_task_status_response(task, include_snapshots=include_snapshots) for task in tasks],
        total=total,
        page=page,
        page_size=page_size,
        total_pages=max(1, total_pages)
    )

@router.delete("/tasks/{task_id}")
async def delete_review_task(task_id: int, db: AsyncSession = Depends(get_db)):
    task = await db.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    await db.execute(delete(ConflictCard).where(ConflictCard.task_id == task_id))
    await db.delete(task)
    await db.commit()
    return {"message": "task deleted", "task_id": task_id}

@router.post("/tasks/{task_id}/snapshots", response_model=ReviewTaskStatusResponse)
async def save_review_snapshot(
    task_id: int,
    payload: SaveSnapshotRequest,
    db: AsyncSession = Depends(get_db)
):
    task = await db.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    snapshot = {
        "task_id": task.id,
        "module": payload.module or task.module,
        "status": "manual_saved",
        "processing_time_sec": payload.processing_time_sec,
        "blocks": [b.model_dump() for b in payload.blocks],
        "conflicts": [c.model_dump() for c in payload.conflicts],
        "supplementaryInfo": [s.model_dump() for s in (payload.supplementaryInfo or [])],
        "created_at": datetime.utcnow().isoformat()
    }
    history = task.snapshot_history or []
    history.insert(0, snapshot)
    task.snapshot_history = history
    task.updated_at = datetime.utcnow()
    await db.commit()
    await db.refresh(task)
    return _to_task_status_response(task)

@router.post("/tasks/{task_id}/rerun", response_model=ReviewSubmitResponse)
async def rerun_review_task(
    task_id: int,
    payload: dict = Body(...),
    background_tasks: BackgroundTasks = None,
    db: AsyncSession = Depends(get_db)
):
    content = (payload.get("content") or "").strip()
    module = (payload.get("module") or "").strip()
    if not content:
        raise HTTPException(status_code=422, detail="content is required")

    task = await db.get(ReviewTask, task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")

    try:
        task.origin_content = content
        if module:
            task.module = module
        task.status = "pending"
        task.processing_time_sec = None
        task.error_message = None
        task.optimized_content = None
        task.result_snapshot = None
        task.snapshot_history = []
        task.updated_at = datetime.utcnow()

        await db.execute(delete(ConflictCard).where(ConflictCard.task_id == task.id))
        await db.commit()

        if background_tasks is not None:
            background_tasks.add_task(_run_review_task_async, task.id, task.module, content)

        return ReviewSubmitResponse(
            task_id=task.id,
            module=task.module,
            status="pending"
        )
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Rerun failed: {str(e)}")

@router.get("/system-prompt")
async def get_review_system_prompt():
    return {"prompt": get_conflict_analysis_prompt()}

@router.put("/system-prompt")
async def update_review_system_prompt(payload: dict = Body(...)):
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="prompt is required")
    set_conflict_analysis_prompt(prompt)
    return {"message": "系统提示词已更新", "prompt": prompt}

@router.post("/merge/{task_id}")
async def merge_confirmation(
    task_id: int,
    payload: dict = Body(...),
    background_tasks: BackgroundTasks = None,
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
                "message": "文档已存在，知识库无需重复索引",
                "task_id": task_id,
                "document_id": existing_doc.id,
                "chunks_processed": 0
            }

        requirement_title = _extract_requirement_title(final_content)
        safe_title = _sanitize_filename_title(requirement_title)
        # Prevent OS "filename too long" (usually 255 bytes for basename).
        file_prefix = f"{content_hash}_"
        file_ext = ".md"
        max_basename_bytes = 240
        title_max_bytes = max(
            16,
            max_basename_bytes - len(file_prefix.encode("utf-8")) - len(file_ext.encode("utf-8"))
        )
        safe_title = _truncate_utf8(safe_title, title_max_bytes).strip(" .") or "未命名需求"
        filename = f"{safe_title}{file_ext}"
        file_path = os.path.join(UPLOAD_DIR, f"{file_prefix}{filename}")
        with open(file_path, "wb") as f:
            f.write(content_bytes)

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

        if background_tasks is not None:
            background_tasks.add_task(
                _run_merge_index_async,
                task_id,
                final_content,
                task.module,
                filename,
                file_path,
                content_hash
            )
        return {
            "message": "Merge 成功，文档已归档并进入后台索引",
            "task_id": task_id,
            "document_id": new_doc.id,
            "chunks_processed": 0,
            "indexing_status": "processing"
        }
    except HTTPException:
        await db.rollback()
        raise
    except Exception as e:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")
