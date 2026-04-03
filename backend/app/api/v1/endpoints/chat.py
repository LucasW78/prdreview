from fastapi import APIRouter, Depends, HTTPException
from typing import Any
from app.schemas.chat_schemas import ChatRequest, ChatResponse, SourceDoc
from app.services.rag_service import search_similar_documents
from app.services.llm_service import answer_question
import time

router = APIRouter()

@router.post("/ask", response_model=ChatResponse)
async def ask_question(request: ChatRequest) -> Any:
    """
    接收用户问题，检索知识库，返回解答和引用来源。
    """
    try:
        # 1. 根据问题检索相关文档片段 (这里取 top 5)
        # 如果是"全部"模块，传入None让底层查询所有
        target_module = request.module if request.module and request.module != "全部" else None
        
        # 记录检索时间
        start_time = time.time()
        retrieved_docs = search_similar_documents(request.query, target_module, limit=5)
        print(f"RAG search took {time.time() - start_time:.2f}s, found {len(retrieved_docs)} docs")

        # 2. 调用大模型生成回答
        # 转换history格式为dict列表
        history_dicts = [{"role": msg.role, "content": msg.content} for msg in request.history]
        
        answer = answer_question(request.query, retrieved_docs, history_dicts)

        # 3. 组装响应数据
        sources = []
        for doc in retrieved_docs:
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
