import time
import json
import os
import hashlib
import re
import asyncio
from datetime import datetime
from typing import List, Dict, Any
from fastapi import APIRouter, Depends, HTTPException, Body, BackgroundTasks, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import delete, func

from app.db.base import get_db, AsyncSessionLocal
from app.models.all_models import ReviewTask, ConflictCard, DocumentMetadata, SystemConfig
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
from app.core.permissions import ensure_super_admin, PermissionContext, get_permission_context

router = APIRouter(dependencies=[Depends(ensure_super_admin)])
UPLOAD_DIR = "uploads"
os.makedirs(UPLOAD_DIR, exist_ok=True)
RUNTIME_LOG_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../../runtime_logs"))
ANALYSIS_PARSE_LOG_FILE = os.path.join(RUNTIME_LOG_DIR, "analysis_parse_failures.jsonl")
REVIEW_PROMPT_CONFIG_KEY = "review_system_prompt_v1"

def _now_iso() -> str:
    """Return current UTC timestamp in ISO format for prompt version metadata."""
    return datetime.utcnow().isoformat()

def _normalize_prompt_history_items(items: Any) -> List[dict]:
    """Normalize persisted prompt history into ordered, UI-safe version entries."""
    if not isinstance(items, list):
        return []
    out: List[dict] = []
    for idx, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        prompt = str(item.get("prompt") or "").strip()
        if not prompt:
            continue
        out.append({
            "version": str(item.get("version") or f"v{idx + 1}"),
            "prompt": prompt,
            "updated_by": str(item.get("updated_by") or ""),
            "created_at": str(item.get("created_at") or _now_iso())
        })
    return out

def _build_prompt_config_payload(history: List[dict], current_version: str) -> dict:
    """Build config payload persisted in system_configs for prompt history + active version."""
    return {
        "current_version": current_version,
        "history": history
    }

async def _get_review_prompt_config_row(db: AsyncSession) -> SystemConfig | None:
    """Fetch the system config row that stores review prompt history and active version."""
    result = await db.execute(select(SystemConfig).where(SystemConfig.config_key == REVIEW_PROMPT_CONFIG_KEY))
    return result.scalars().first()

async def _ensure_prompt_history(
    db: AsyncSession,
    runtime_prompt: str,
    operator: str
) -> tuple[SystemConfig, List[dict], str]:
    """Ensure history exists; seed from runtime prompt if DB is empty."""
    row = await _get_review_prompt_config_row(db)
    if row and isinstance(row.config_value, dict):
        cfg = row.config_value or {}
        history = _normalize_prompt_history_items(cfg.get("history"))
        if history:
            current_version = str(cfg.get("current_version") or history[-1]["version"])
            return row, history, current_version
    seeded_prompt = (runtime_prompt or "").strip()
    if not seeded_prompt:
        seeded_prompt = get_conflict_analysis_prompt().strip()
    history = [{
        "version": "v1",
        "prompt": seeded_prompt,
        "updated_by": operator,
        "created_at": _now_iso()
    }]
    cfg = _build_prompt_config_payload(history, "v1")
    if not row:
        row = SystemConfig(config_key=REVIEW_PROMPT_CONFIG_KEY, config_value=cfg)
        db.add(row)
    else:
        row.config_value = cfg
    await db.commit()
    await db.refresh(row)
    return row, history, "v1"

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

def _build_review_queries(content: str) -> List[str]:
    text = (content or "").strip()
    if not text:
        return []
    lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
    queries: List[str] = []
    # Probe 1: full context (bounded) for holistic retrieval
    queries.append(text[:3000])
    # Probe 2: title / first heading
    heading = next((ln.lstrip("# ").strip() for ln in lines if ln.startswith("#")), "")
    if heading:
        queries.append(heading)
    # Probe 3: conflict-prone rule lines
    conflict_keywords = ("必须", "强制", "覆盖", "不得", "禁止", "应当", "建议", "可选")
    rule_lines = [ln for ln in lines if any(k in ln for k in conflict_keywords)]
    if rule_lines:
        queries.append("\n".join(rule_lines[:10])[:2000])
    # Probe 4: top section summary
    if lines:
        queries.append("\n".join(lines[:12])[:2000])
    # Keep order and dedupe
    seen = set()
    out: List[str] = []
    for q in queries:
        qq = q.strip()
        if not qq or qq in seen:
            continue
        seen.add(qq)
        out.append(qq)
    return out[:4]

def _merge_retrieved_docs(docs: List[Dict], keep: int) -> List[Dict]:
    merged: Dict[str, Dict] = {}
    for d in docs:
        key = f"{d.get('filename','')}|{d.get('header_path','')}|{d.get('doc_type','')}|{d.get('module','')}"
        if key not in merged or (d.get("score", 0.0) > merged[key].get("score", 0.0)):
            merged[key] = d
    out = list(merged.values())
    out.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    return out[:keep]

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
            chunks_count = await asyncio.to_thread(process_document, final_content, module, filename, "prd")
            await db.execute(
                DocumentMetadata.__table__.update()
                .where(DocumentMetadata.module == module)
                .where(DocumentMetadata.doc_type == "prd")
                .where(DocumentMetadata.content_hash != content_hash)
                .values(is_latest=False)
            )
            existing_result = await db.execute(
                select(DocumentMetadata)
                .where(DocumentMetadata.content_hash == content_hash)
                .where(DocumentMetadata.module == module)
                .where(DocumentMetadata.doc_type == "prd")
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
            # Multi-probe retrieval: title/rule lines/full context to improve conflict recall.
            query_probes = _build_review_queries(content)
            sop_candidates: List[Dict] = []
            prd_candidates: List[Dict] = []
            for q in query_probes:
                sop_candidates.extend(
                    search_similar_documents(
                        query=q,
                        module=module,
                        limit=6,
                        doc_types=["sop"]
                    )
                )
                prd_candidates.extend(
                    search_similar_documents(
                        query=q,
                        module=module,
                        limit=3,
                        doc_types=["prd"]
                    )
                )
            retrieved_sop = _merge_retrieved_docs(sop_candidates, keep=10)
            retrieved_prd = _merge_retrieved_docs(prd_candidates, keep=6)
            retrieved_docs = retrieved_sop + retrieved_prd

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
                        description=c.get("description", "")
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
async def get_review_system_prompt(
    db: AsyncSession = Depends(get_db),
):
    """Return active review system prompt with version metadata and full history."""
    runtime_prompt = get_conflict_analysis_prompt().strip()
    _, history, current_version = await _ensure_prompt_history(db, runtime_prompt, "system")
    current_item = next((item for item in history if item["version"] == current_version), history[-1])
    if current_item.get("prompt"):
        set_conflict_analysis_prompt(current_item["prompt"])
    return {
        "prompt": current_item["prompt"],
        "current_version": current_item["version"],
        "history": list(reversed(history))
    }

@router.put("/system-prompt")
async def update_review_system_prompt(
    payload: dict = Body(...),
    ctx: PermissionContext = Depends(get_permission_context),
    db: AsyncSession = Depends(get_db)
):
    """Save a new prompt as the next version and make it active immediately."""
    prompt = (payload.get("prompt") or "").strip()
    if not prompt:
        raise HTTPException(status_code=422, detail="prompt is required")
    operator = (ctx.email or "system").strip() or "system"
    _, history, current_version = await _ensure_prompt_history(db, get_conflict_analysis_prompt(), operator)
    active_item = next((item for item in history if item["version"] == current_version), history[-1])
    if active_item["prompt"] == prompt:
        set_conflict_analysis_prompt(prompt)
        return {
            "message": "系统提示词未变化",
            "prompt": prompt,
            "current_version": active_item["version"],
            "history": list(reversed(history))
        }
    next_version = f"v{len(history) + 1}"
    history.append({
        "version": next_version,
        "prompt": prompt,
        "updated_by": operator,
        "created_at": _now_iso()
    })
    row = await _get_review_prompt_config_row(db)
    if not row:
        row = SystemConfig(config_key=REVIEW_PROMPT_CONFIG_KEY, config_value={})
        db.add(row)
    row.config_value = _build_prompt_config_payload(history, next_version)
    await db.commit()
    set_conflict_analysis_prompt(prompt)
    return {
        "message": "系统提示词已更新",
        "prompt": prompt,
        "current_version": next_version,
        "history": list(reversed(history))
    }

@router.get("/system-prompt/history")
async def get_review_system_prompt_history(
    db: AsyncSession = Depends(get_db),
):
    """Return all prompt versions with active version marker."""
    runtime_prompt = get_conflict_analysis_prompt().strip()
    _, history, current_version = await _ensure_prompt_history(db, runtime_prompt, "system")
    return {
        "current_version": current_version,
        "history": list(reversed(history))
    }

@router.post("/system-prompt/rollback")
async def rollback_review_system_prompt(
    payload: dict = Body(...),
    _: PermissionContext = Depends(ensure_super_admin),
    db: AsyncSession = Depends(get_db)
):
    """Rollback active prompt to a selected historical version."""
    version = str(payload.get("version") or "").strip()
    if not version:
        raise HTTPException(status_code=422, detail="version is required")
    row = await _get_review_prompt_config_row(db)
    if not row or not isinstance(row.config_value, dict):
        raise HTTPException(status_code=404, detail="prompt history not found")
    cfg = row.config_value or {}
    history = _normalize_prompt_history_items(cfg.get("history"))
    target = next((item for item in history if item["version"] == version), None)
    if not target:
        raise HTTPException(status_code=404, detail="version not found")
    row.config_value = _build_prompt_config_payload(history, version)
    await db.commit()
    set_conflict_analysis_prompt(target["prompt"])
    return {
        "message": "已回滚到指定版本",
        "prompt": target["prompt"],
        "current_version": version,
        "history": list(reversed(history))
    }

@router.get("/analysis-parse-failures")
async def get_analysis_parse_failures(
    limit: int = Query(50, ge=1, le=500),
    keyword: str = Query("", description="按模块/内容关键字过滤")
):
    if not os.path.exists(ANALYSIS_PARSE_LOG_FILE):
        return {"items": [], "total": 0}
    items: List[dict] = []
    kw = (keyword or "").strip().lower()
    try:
        with open(ANALYSIS_PARSE_LOG_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if kw:
                    text = f"{rec.get('module','')} {rec.get('content_preview','')} {rec.get('raw_response_preview','')}".lower()
                    if kw not in text:
                        continue
                items.append(rec)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"read parse failure logs failed: {str(e)}")
    items = list(reversed(items))[:limit]
    return {"items": items, "total": len(items)}

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
            select(DocumentMetadata)
            .where(DocumentMetadata.content_hash == content_hash)
            .where(DocumentMetadata.module == task.module)
            .where(DocumentMetadata.doc_type == "prd")
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
            "message": "导入成功，文档已归档并进入后台索引",
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
