import json
import re
from typing import List, Dict, Any
from langchain_community.chat_models import ChatTongyi
from langchain.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from app.core.config import settings

# Initialize Qwen LLM (DashScope)
llm = ChatTongyi(
    model_name="qwen-plus", # Fixed typo: qwen3.5-plus to qwen-plus
    dashscope_api_key=settings.DASHSCOPE_API_KEY,
    temperature=0.2,
)

CONFLICT_ANALYSIS_PROMPT = """
你是严格的需求冲突审计专家。请基于“新需求”和“历史背景”做逐条对比。

输入信息：
- 模块: {module}
- 新需求:
{new_content}
- 历史背景:
{context}

审计规则：
1) originalText 必须与新需求原文完全一致。
2) 若历史规则为“参考建议/可选/非强制”，而新需求改为“强制/必须/覆盖”，判定为 logic_conflict，severity=High。
3) 若新需求缺少历史 SOP 中必须步骤，判定为 sop_missing。
4) aiText 需给出合规修正版本；无修改时与 originalText 相同。

输出要求：
- 仅返回 JSON 字符串，不要 Markdown 包裹。
- 顶层字段必须包含：blocks(数组)、conflicts(数组)、supplementaryInfo(数组)。
- blocks 每项包含：id, originalText, aiText, hasChange, changeType。
- conflicts 每项包含：id, blockId, type, severity, description, sourceContext, ignored。
- supplementaryInfo 每项包含：id, blockId, title, content, source。
"""

prompt_template = ChatPromptTemplate.from_template(CONFLICT_ANALYSIS_PROMPT)

def _escape_control_chars_in_json_string(raw: str) -> str:
    out = []
    in_string = False
    escaped = False
    for ch in raw:
        if in_string:
            if escaped:
                out.append(ch)
                escaped = False
                continue
            if ch == "\\":
                out.append(ch)
                escaped = True
                continue
            if ch == "\"":
                out.append(ch)
                in_string = False
                continue
            if ch == "\n":
                out.append("\\n")
                continue
            if ch == "\r":
                out.append("\\r")
                continue
            if ch == "\t":
                out.append("\\t")
                continue
            out.append(ch)
        else:
            out.append(ch)
            if ch == "\"":
                in_string = True
    return "".join(out)

async def analyze_conflicts(module: str, new_content: str, retrieved_docs: List[Dict]) -> Dict[str, Any]:
    """
    Calls Qwen to analyze conflicts between new content and retrieved docs.
    """
    # Format context
    context_str = ""
    for i, doc in enumerate(retrieved_docs):
        context_str += f"--- Document {i+1} ---\n"
        context_str += f"Source: {doc.get('filename')} | Path: {doc.get('header_path')} | Score: {doc.get('score'):.2f}\n"
        context_str += f"Content: {doc.get('content')}\n\n"

    # Generate prompt
    messages = prompt_template.format_messages(
        module=module,
        new_content=new_content,
        context=context_str if context_str else "No historical context found."
    )

    # Call LLM
    response = await llm.ainvoke(messages)
    
    # Parse JSON response
    try:
        # Clean up potential markdown formatting from LLM response
        content = response.content.strip()
        print(f"LLM Raw Response: {content}") # Add logging to see raw response
        
        if content.startswith("```json"):
            content = content[7:]
        if content.startswith("```"): # Handle case where only ``` is used
            content = content[3:]
        if content.endswith("```"):
            content = content[:-3]
            
        content = content.strip()
        content = re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", content)
        match = re.search(r"\{[\s\S]*\}", content)
        if match:
            content = match.group(0)
        content = _escape_control_chars_in_json_string(content)
        result = json.loads(content)
        return result
    except json.JSONDecodeError as e:
        print(f"Failed to parse LLM response: {response.content}")
        # Fallback to a safe default if LLM fails to output valid JSON
        return {
            "blocks": [{"id": "b1", "originalText": new_content, "aiText": new_content + "\n\n(AI分析结果解析失败，请查看后台日志)", "hasChange": False}],
            "conflicts": [{"id": "err1", "type": "conflict", "description": f"AI Response Parsing Error. Raw content: {content[:100]}...", "ignored": False, "blockId": "b1"}]
        }

QA_SYSTEM_PROMPT = """你是一个专业的知识库问答助手。
请基于以下提供的参考文档片段，回答用户的问题。
要求：
1. 回答要清晰、准确、专业。
2. 如果参考文档中没有能够回答该问题的信息，请直接回复"抱歉，根据现有知识库内容，我无法回答这个问题。"。请不要编造答案。
3. 请尽可能结合多个文档片段提供全面的解答。
4. 可以使用 Markdown 格式来排版你的回答，使其更易读。

【参考文档片段开始】
{context}
【参考文档片段结束】
"""

def answer_question(query: str, retrieved_docs: List[Dict], history: List[Dict] = None) -> str:
    """
    通用知识库问答方法，支持多轮对话上下文。
    """
    # 组装上下文
    context_parts = []
    for i, doc in enumerate(retrieved_docs):
        context_parts.append(f"--- 片段 {i+1} ---\n来源: {doc.get('filename')}\n内容: {doc.get('content')}\n")
    context_str = "\n".join(context_parts) if context_parts else "未检索到相关参考文档。"

    # 组装消息列表
    messages = [
        SystemMessage(content=QA_SYSTEM_PROMPT.format(context=context_str))
    ]

    # 添加历史记录
    if history:
        for msg in history:
            if msg.get("role") == "user":
                messages.append(HumanMessage(content=msg.get("content")))
            elif msg.get("role") == "assistant":
                messages.append(AIMessage(content=msg.get("content")))

    # 添加当前问题
    messages.append(HumanMessage(content=query))

    try:
        response = llm.invoke(messages)
        return response.content
    except Exception as e:
        print(f"Error in answer_question: {e}")
        return "抱歉，在生成回答时遇到了服务器错误，请稍后再试。"
