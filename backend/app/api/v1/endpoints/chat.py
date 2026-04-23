from fastapi import APIRouter, HTTPException
from fastapi import Depends
from typing import Any
import re
from app.schemas.chat_schemas import ChatRequest, ChatResponse, SourceDoc
from app.services.rag_service import search_similar_documents
from app.services.llm_service import answer_question_async, rewrite_query, build_history_context
from app.core.permissions import get_permission_context, PermissionContext, ensure_module_access

router = APIRouter()

NO_EVIDENCE_PATTERNS = [
    "未检索到直接依据",
    "知识库中未提供相关依据",
    "根据现有知识库内容，我无法回答这个问题",
    "无法回答这个问题",
]

def _extract_citation_ids(answer: str) -> set[str]:
    """Extract citation ids like [S1]/[s2]/[1] from answer text."""
    text = (answer or "").strip()
    if not text:
        return set()
    ids: set[str] = set()
    for matched in re.findall(r"\[(?:S)?(\d+)\]", text, flags=re.IGNORECASE):
        if matched:
            ids.add(f"S{matched}")
    return ids

def _should_hide_sources(answer: str) -> bool:
    """Decide whether to suppress sources for pure no-evidence answers."""
    text = (answer or "").strip()
    if not text:
        return True
    # If answer explicitly cites [Sx], keep sources visible.
    if _extract_citation_ids(text):
        return False
    return any(p in text for p in NO_EVIDENCE_PATTERNS)

def _rerank_by_query_focus(query: str, docs: list[dict], keep: int = 4) -> list[dict]:
    tokens = [t.lower() for t in re.findall(r"[A-Za-z0-9]{2,}|[\u4e00-\u9fa5]{2,}", query or "")]
    if not tokens:
        return docs[:keep]
    reranked = []
    for d in docs:
        text = f"{d.get('filename','')} {d.get('header_path','')} {d.get('content','')}".lower()
        overlap = sum(1 for t in tokens if t in text)
        ratio = overlap / max(len(tokens), 1)
        fused_score = d.get("score", 0.0) * 0.85 + ratio * 0.15
        nd = dict(d)
        nd["score"] = fused_score
        reranked.append(nd)
    reranked.sort(key=lambda x: x.get("score", 0.0), reverse=True)
    return reranked[:keep]

@router.post("/ask", response_model=ChatResponse)
async def ask_question(
    request: ChatRequest,
    ctx: PermissionContext = Depends(get_permission_context)
) -> Any:
    """
    接收用户问题，检索知识库，返回解答和引用来源。
    """
    try:
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
        context_history = await build_history_context(history_dicts)
        search_query = await rewrite_query(request.query, context_history)
        # 1. 根据问题检索相关文档片段 (这里取 top 5)
        # 如果是"全部"模块，传入None让底层查询所有
        if ctx.is_super_admin:
            target_module = request.module if request.module and request.module != "全部" else None
        else:
            if not request.module or request.module == "全部":
                raise HTTPException(status_code=403, detail="业务线用户需指定所属业务线模块")
            ensure_module_access(ctx, request.module)
            target_module = request.module
        
        retrieved_docs = search_similar_documents(search_query, target_module, limit=6, doc_types=["sop", "prd"])
        retrieved_docs = _rerank_by_query_focus(search_query, retrieved_docs, keep=4)

        # 2. 调用大模型生成回答
        answer = await answer_question_async(request.query, retrieved_docs, context_history)

        # 3. 组装响应数据：若出现引用 [Sx]，优先返回被引用来源
        all_sources = []
        seen = set()
        for doc in retrieved_docs:
            key = (doc.get("filename"), doc.get("header_path"))
            if key in seen:
                continue
            seen.add(key)
            all_sources.append(SourceDoc(
                source_id=f"S{len(all_sources)+1}",
                filename=doc.get("filename", "未知文件"),
                header_path=doc.get("header_path", ""),
                content=doc.get("content", ""),
                score=doc.get("score", 0.0),
                module=doc.get("module", "未知模块"),
                doc_type=doc.get("doc_type", "prd")
            ))

        cited_ids = _extract_citation_ids(answer)
        if cited_ids:
            sources = [s for s in all_sources if (s.source_id or "").upper() in cited_ids]
            if not sources:
                sources = all_sources
        elif _should_hide_sources(answer):
            sources = []
        else:
            sources = all_sources

        return ChatResponse(
            answer=answer,
            sources=sources
        )

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to generate answer: {str(e)}")
