from fastapi import APIRouter, HTTPException
from typing import Any
import re
from app.schemas.chat_schemas import ChatRequest, ChatResponse, SourceDoc
from app.services.rag_service import search_similar_documents
from app.services.llm_service import answer_question, rewrite_query, build_history_context
import time

router = APIRouter()

NO_EVIDENCE_PATTERNS = [
    "未检索到直接依据",
    "知识库中未提供相关依据",
    "根据现有知识库内容，我无法回答这个问题",
    "无法回答这个问题",
]

def _should_hide_sources(answer: str) -> bool:
    text = (answer or "").strip()
    if not text:
        return True
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
async def ask_question(request: ChatRequest) -> Any:
    """
    接收用户问题，检索知识库，返回解答和引用来源。
    """
    try:
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
        context_history = await build_history_context(history_dicts)
        search_query = await rewrite_query(request.query, context_history)
        # 1. 根据问题检索相关文档片段 (这里取 top 5)
        # 如果是"全部"模块，传入None让底层查询所有
        target_module = request.module if request.module and request.module != "全部" else None
        
        # 记录检索时间
        start_time = time.time()
        retrieved_docs = search_similar_documents(search_query, target_module, limit=5)
        retrieved_docs = _rerank_by_query_focus(search_query, retrieved_docs, keep=4)
        print(f"RAG search took {time.time() - start_time:.2f}s, found {len(retrieved_docs)} docs")

        # 2. 调用大模型生成回答
        answer = answer_question(request.query, retrieved_docs, context_history)

        # 3. 组装响应数据：若回答判定“无直接依据”，不返回参考来源
        sources = []
        if not _should_hide_sources(answer):
            seen = set()
            for doc in retrieved_docs:
                key = (doc.get("filename"), doc.get("header_path"))
                if key in seen:
                    continue
                seen.add(key)
                sources.append(SourceDoc(
                    filename=doc.get("filename", "未知文件"),
                    content=doc.get("content", ""),
                    score=doc.get("score", 0.0),
                    module=doc.get("module", "未知模块")
                ))

        return ChatResponse(
            answer=answer,
            sources=sources
        )

    except Exception as e:
        print(f"Error processing chat request: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to generate answer: {str(e)}")
