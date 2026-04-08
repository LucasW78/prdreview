import json
import re
from typing import List, Dict, Any
from langchain_community.chat_models import ChatTongyi
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage
from app.core.config import settings

# Initialize Qwen LLM (DashScope)
llm = ChatTongyi(
    model_name="qwen-plus", # Fixed typo: qwen3.5-plus to qwen-plus
    dashscope_api_key=settings.DASHSCOPE_API_KEY,
    temperature=0.2,
)

CONFLICT_ANALYSIS_PROMPT = """
你是严格的需求冲突审计专家。你的任务是仅根据提供材料进行逐条审计，不得编造。

请按以下步骤执行：
1) 先检查输入是否满足分析条件：
   - 如果 <NEW_REQUIREMENT> 为空或仅噪声，返回空结果结构。
   - 如果 <HISTORICAL_CONTEXT> 明确为无历史信息，仅做“风险提示”，不得虚构冲突来源。
2) 再对比新需求与历史背景，识别冲突、缺失和可补充信息。
3) 最后输出严格 JSON。

输入（使用分隔标签）：
<MODULE>
__MODULE__
</MODULE>

<NEW_REQUIREMENT>
__NEW_REQUIREMENT__
</NEW_REQUIREMENT>

<HISTORICAL_CONTEXT>
__HISTORICAL_CONTEXT__
</HISTORICAL_CONTEXT>

审计规则：
- R1: originalText 必须与新需求中的原文片段完全一致，不可改写。
- R2: 历史为“建议/可选/非强制”，新需求改为“必须/强制/覆盖”，判定 type=logic_conflict，severity=High。
- R3: 新需求缺少历史 SOP 的必做步骤，判定 type=sop_missing，severity 至少为 Medium。
- R4: aiText 给出可落地修正稿；若无需修改，aiText 与 originalText 相同。
- R5: 每条 conflict 必须给出可追溯 sourceContext（引用历史依据摘要）。
- R6: 只有在历史上下文存在“明确可引用原文证据”时才允许输出 conflict；若仅为推测或证据不足，必须放入 supplementaryInfo，不得判定冲突。
- R7: 若某 block 的 hasChange=true，则 aiText 必须与 originalText 实质不同，不可完全相同。

输出格式要求（必须严格遵守）：
- 只输出 JSON，不要 Markdown，不要解释文本。
- 顶层键必须且仅应包含：blocks, conflicts, supplementaryInfo。
- JSON Schema:
{
  "blocks": [
    {
      "id": "b1",
      "originalText": "string",
      "aiText": "string",
      "hasChange": true,
      "changeType": "string"
    }
  ],
  "conflicts": [
    {
      "id": "c1",
      "blockId": "b1",
      "type": "logic_conflict|sop_missing|conflict|other",
      "severity": "High|Medium|Low",
      "description": "string",
      "sourceContext": "string",
      "ignored": false
    }
  ],
  "supplementaryInfo": [
    {
      "id": "s1",
      "blockId": "b1",
      "title": "string",
      "content": "string",
      "source": "string"
    }
  ]
}

无冲突时：
- conflicts 返回 []
- blocks 仍返回至少 1 条，标记 hasChange=false
- supplementaryInfo 可为空 []
"""

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

def _sanitize_analysis_result(result: Dict[str, Any], new_content: str) -> Dict[str, Any]:
    blocks = result.get("blocks") or []
    conflicts = result.get("conflicts") or []
    supp = result.get("supplementaryInfo") or []

    if not blocks:
        blocks = [{
            "id": "b1",
            "originalText": new_content,
            "aiText": new_content,
            "hasChange": False,
            "changeType": "none"
        }]

    block_ids = {b.get("id") for b in blocks if b.get("id")}
    filtered_conflicts = []
    for c in conflicts:
        if c.get("blockId") not in block_ids:
            continue
        source = (c.get("sourceContext") or "").strip()
        desc = (c.get("description") or "").strip()
        low_evidence = (not source) or ("未找到" in source) or ("推测" in source) or ("可能" in source and len(source) < 20)
        if low_evidence or not desc:
            continue
        filtered_conflicts.append(c)

    conflicts_by_block = {}
    for c in filtered_conflicts:
        conflicts_by_block.setdefault(c.get("blockId"), []).append(c)

    normalized_blocks = []
    for b in blocks:
        original = (b.get("originalText") or "").strip()
        ai_text = (b.get("aiText") or "").strip()
        related = conflicts_by_block.get(b.get("id"), [])
        if related and ai_text == original:
            desc = (related[0].get("description") or "").strip()
            if ("强制覆盖" in original) and (("非强制覆盖" in desc) or ("不具备强制覆盖" in desc) or ("参考建议" in desc)):
                ai_text = original.replace("具备强制覆盖性，能直接修改业务逻辑。", "不具备强制覆盖性，作为参考建议用于提示评审，不直接修改业务逻辑。")
                if ai_text == original:
                    ai_text = original.replace("强制覆盖", "参考建议（非强制）")
            elif ("必须" in original) and (("建议" in desc) or ("可选" in desc)):
                ai_text = original.replace("必须", "建议")
            elif ("应当" in original) and ("可选" in desc):
                ai_text = original.replace("应当", "可选")
            else:
                ai_text = f"{original}（根据历史规范已调整）"
        has_change = ai_text != original
        normalized_blocks.append({
            **b,
            "aiText": ai_text,
            "hasChange": has_change
        })

    return {
        "blocks": normalized_blocks,
        "conflicts": filtered_conflicts,
        "supplementaryInfo": supp
    }

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
    prompt = (
        CONFLICT_ANALYSIS_PROMPT
        .replace("__MODULE__", module or "")
        .replace("__NEW_REQUIREMENT__", new_content or "")
        .replace("__HISTORICAL_CONTEXT__", context_str if context_str else "No historical context found.")
    )
    messages = [HumanMessage(content=prompt)]

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
        return _sanitize_analysis_result(result, new_content)
    except json.JSONDecodeError as e:
        print(f"Failed to parse LLM response: {response.content}")
        # Fallback to a safe default if LLM fails to output valid JSON
        return {
            "blocks": [{"id": "b1", "originalText": new_content, "aiText": new_content + "\n\n(AI分析结果解析失败，请查看后台日志)", "hasChange": False}],
            "conflicts": [{"id": "err1", "type": "conflict", "description": f"AI Response Parsing Error. Raw content: {content[:100]}...", "ignored": False, "blockId": "b1"}]
        }

QA_SYSTEM_PROMPT = """你是专业的知识库问答助手。你必须遵循“先核对证据、再作答”的流程。

输入会包含两个分隔区：
<CONTEXT>...知识库片段...</CONTEXT>
<QUESTION>...用户问题...</QUESTION>

执行规则：
1) 仅使用 <CONTEXT> 中的信息回答，不得引入外部事实。
2) 先判断证据充分性：
   - 若证据完全不足，回复：
   抱歉，根据现有知识库内容，我无法回答这个问题。
   - 若证据部分相关，先给出“可确认信息”，再明确“未检索到直接依据”的部分，不得编造。
3) 若可回答，优先整合多片段共识，避免只依赖单片段。
4) 若发现同一事实在不同片段中存在冲突（如版本号、时间、数量），必须明确标注“存在信息冲突”，不得擅自二选一断言。
5) 仅回答与 <QUESTION> 直接相关的信息，忽略无关细节。
6) 回答要点化、准确、可读，可使用 Markdown。
7) 不输出推理过程，不输出与问题无关内容。
"""

REFUSAL_TEXT = "抱歉，根据现有知识库内容，我无法回答这个问题。"

def _is_refusal_answer(text: str) -> bool:
    t = (text or "").strip()
    return REFUSAL_TEXT in t or "无法回答这个问题" in t

def _extractive_fallback_answer(query: str, retrieved_docs: List[Dict]) -> str:
    if not retrieved_docs:
        return REFUSAL_TEXT
    top_docs = sorted(retrieved_docs, key=lambda d: d.get("score", 0.0), reverse=True)[:2]
    lines = ["根据当前检索到的参考来源，可确认的信息如下："]
    for i, doc in enumerate(top_docs, start=1):
        filename = doc.get("filename", "未知文件")
        header = doc.get("header_path", "未分段")
        content = (doc.get("content") or "").strip().replace("\n", " ")
        if len(content) > 180:
            content = content[:180] + "..."
        lines.append(f"{i}. 来源：{filename} / {header}")
        lines.append(f"   - 相关片段：{content or '（该片段无可读内容）'}")
    lines.append("若你需要更精确答案，请补充更具体的问题关键词（例如模块、字段名、流程步骤、版本号）。")
    return "\n".join(lines)

QUERY_REWRITE_PROMPT = """你是查询改写助手。请将用户最新问题改写为可独立检索的查询句。

输入：
<HISTORY>
{history}
</HISTORY>

<QUESTION>
{question}
</QUESTION>

规则：
1) 仅做“指代消解、语义补全、实体补全”，不改变用户真实意图。
2) 若最新问题已完整，原样返回。
3) 只输出一行改写后的查询，不要解释，不要加引号。
"""

HISTORY_SUMMARY_PROMPT = """你是对话上下文压缩助手。请把历史多轮对话压缩成后续问答可用的摘要。

输入：
<HISTORY>
{history}
</HISTORY>

输出要求：
1) 只输出摘要正文，不要前后解释。
2) 保留关键信息：目标、实体、约束、偏好、未解决问题。
3) 使用 4-8 条要点，每条简洁明确。
4) 不得编造，未知信息不要补全。
"""

async def rewrite_query(query: str, history: List[Dict] = None) -> str:
    if not history:
        return query
    recent = history[-6:]
    history_text = "\n".join([f"{m.get('role','user')}: {m.get('content','')}" for m in recent if m.get("content")])
    if not history_text.strip():
        return query
    prompt = QUERY_REWRITE_PROMPT.format(history=history_text, question=query)
    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        rewritten = (response.content or "").strip()
        if not rewritten:
            return query
        return rewritten
    except Exception:
        return query

async def build_history_context(history: List[Dict] = None, keep_recent: int = 6, trigger_turns: int = 8) -> List[Dict]:
    if not history:
        return []
    if len(history) <= trigger_turns:
        return history
    older = history[:-keep_recent]
    recent = history[-keep_recent:]
    older_text = "\n".join([f"{m.get('role','user')}: {m.get('content','')}" for m in older if m.get("content")])
    if not older_text.strip():
        return recent
    prompt = HISTORY_SUMMARY_PROMPT.format(history=older_text)
    try:
        response = await llm.ainvoke([HumanMessage(content=prompt)])
        summary = (response.content or "").strip()
        if not summary:
            summary = "历史对话较长，已省略早期细节，请优先参考最近对话继续回答。"
    except Exception:
        summary = "历史对话较长，已省略早期细节，请优先参考最近对话继续回答。"
    summary_message = {
        "role": "assistant",
        "content": f"【对话历史摘要】\n{summary}"
    }
    return [summary_message] + recent

def answer_question(query: str, retrieved_docs: List[Dict], history: List[Dict] = None) -> str:
    """
    通用知识库问答方法，支持多轮对话上下文。
    """
    # 组装上下文
    context_parts = []
    for i, doc in enumerate(retrieved_docs):
        context_parts.append(
            f"--- 片段 {i+1} ---\n来源: {doc.get('filename')}\n章节: {doc.get('header_path')}\n检索分数: {doc.get('score')}\n内容: {doc.get('content')}\n"
        )
    context_str = "\n".join(context_parts) if context_parts else "未检索到相关参考文档。"

    # 组装消息列表
    messages = [
        SystemMessage(content=QA_SYSTEM_PROMPT)
    ]

    # 添加历史记录
    if history:
        for msg in history:
            if msg.get("role") == "user":
                messages.append(HumanMessage(content=msg.get("content")))
            elif msg.get("role") == "assistant":
                messages.append(AIMessage(content=msg.get("content")))

    # 添加当前问题
    messages.append(HumanMessage(content=f"<CONTEXT>\n{context_str}\n</CONTEXT>\n\n<QUESTION>\n{query}\n</QUESTION>"))

    try:
        response = llm.invoke(messages)
        answer = (response.content or "").strip()
        if retrieved_docs and _is_refusal_answer(answer):
            return _extractive_fallback_answer(query, retrieved_docs)
        return answer
    except Exception as e:
        print(f"Error in answer_question: {e}")
        return "抱歉，在生成回答时遇到了服务器错误，请稍后再试。"
