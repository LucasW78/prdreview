import json
import re
import os
import uuid
import hashlib
from datetime import datetime
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
你是“需求评审专家（RAG）”，负责对新需求进行冲突审计与优化改写。  
你的输出将被程序直接解析，必须严格遵守输出格式。

====================
一、任务目标
====================
你必须完成以下三件事：
1) 识别新需求与历史知识库之间的冲突、偏差、遗漏约束。
2) 给出最小改动原则下的可执行改写建议。
3) 当证据不足时，输出知识库完善建议，指导后续补库。

====================
二、输入（使用分隔标签）
====================
<MODULE>
__MODULE__
</MODULE>

<NEW_REQUIREMENT>
__NEW_REQUIREMENT__
</NEW_REQUIREMENT>

<HISTORICAL_CONTEXT>
__HISTORICAL_CONTEXT__
</HISTORICAL_CONTEXT>

====================
三、执行原则
====================
- 只依据输入内容判断，不得使用外部知识或常识脑补。
- 先做“条件检查”，再做分析：
  - 若 NEW_REQUIREMENT 为空或仅噪声：返回空结构。
  - 若 HISTORICAL_CONTEXT 无有效内容：不得虚构冲突来源，只输出风险提示与补库建议。
- 所有高严重级别冲突必须有证据支撑（sourceContext）。
- 改写必须“最小必要修改”，不得重写整篇。
- originalText 必须是 NEW_REQUIREMENT 原文片段，不得改写。

====================
四、冲突识别规则（优先级从高到低）
====================
R1. 强制升级冲突（重点）
- 历史为“建议/可选/参考/提示”，新需求为“必须/强制/覆盖/直接修改业务逻辑”：
  -> type=logic_conflict, severity=High

R2. 禁止性冲突
- 历史含“不得/禁止/不允许”，新需求反向要求执行：
  -> type=rule_conflict, severity=High

R3. 数据口径冲突
- 字段定义、状态定义、计算口径、版本口径不一致：
  -> type=data_conflict, severity=Medium/High

R4. 流程冲突
- 触发条件、审批顺序、责任角色、回滚路径冲突：
  -> type=process_conflict, severity=Medium/High

R5. 关键约束缺失
- 缺少幂等、权限、异常处理、审计日志、补偿/回滚、SLA 等：
  -> type=missing_constraint, severity=Medium

====================
五、知识库完善逻辑（必须执行）
====================
完成冲突审计后，判断知识库是否足够支撑当前评审。  
若不足，必须在 supplementaryInfo 输出“知识库完善建议”。

触发条件（命中任一即可）：
K1. 关键结论无直接证据或仅单片段弱证据。
K2. 规范只有原则，缺少可执行细则（字段/阈值/分支/异常）。
K3. 存在版本或模块断层（证据过旧、模块不一致、上下游规范缺失）。
K4. 高风险场景缺少边界/反例（权限、资金、计费、状态流转、强制覆盖）。

建议项必须包含：
- 缺失主题（缺什么）
- 建议补充位置（SOP/PRD/接口规范/异常手册）
- 建议补充要点（至少2条）
- 预期收益（降低何种误判/漏检）

====================
六、输出格式（严格 JSON）
====================
你只能输出 JSON，不得输出解释、不得输出 Markdown、不得输出代码块。

顶层必须且仅允许包含以下键：
- blocks
- conflicts
- supplementaryInfo

字段规范：

blocks[]:
- id: string（如 "b1"）
- originalText: string（来自新需求原文）
- aiText: string（改写建议；无需改写可与 originalText 相同）
- hasChange: boolean

conflicts[]:
- id: string（如 "c1"）
- blockId: string（关联 blocks.id）
- type: string（仅允许：logic_conflict | rule_conflict | data_conflict | process_conflict | missing_constraint | conflict）
- severity: string（仅允许：Low | Medium | High）
- description: string（冲突点 + 影响）
- sourceContext: string（证据上下文；无证据时可空字符串）
- ignored: boolean（默认 false）

supplementaryInfo[]:
- id: string
- blockId: string（可关联对应 block；无明确对应时可用 "b1"）
- title: string
- content: string
- source: string（建议值："system" 或 "knowledge_gap_analyzer"）

====================
七、质量自检（输出前必须检查）
====================
- JSON 可被直接解析（严格合法）。
- conflicts 的 blockId 都能在 blocks.id 中找到。
- High 冲突必须有可验证 sourceContext。
- 若证据不足，不得强行输出高置信冲突。
- 若触发 K1~K4，必须输出至少一条知识库完善建议。
- 不得出现“根据经验/通常/一般而言”等外推表述。

====================
八、空场景返回模板
====================
当 NEW_REQUIREMENT 为空或无有效信息时，返回：
{"blocks":[],"conflicts":[],"supplementaryInfo":[]}
"""

def get_conflict_analysis_prompt() -> str:
    return CONFLICT_ANALYSIS_PROMPT

def set_conflict_analysis_prompt(prompt: str) -> None:
    global CONFLICT_ANALYSIS_PROMPT
    CONFLICT_ANALYSIS_PROMPT = prompt

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

def _extract_json_payload(raw: str) -> str:
    content = (raw or "").strip()
    if content.startswith("```json"):
        content = content[7:]
    if content.startswith("```"):
        content = content[3:]
    if content.endswith("```"):
        content = content[:-3]
    content = content.strip()
    content = re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", content)
    match = re.search(r"\{[\s\S]*\}", content)
    if match:
        content = match.group(0)
    return _escape_control_chars_in_json_string(content)

def _parse_analysis_json(raw: str) -> Dict[str, Any]:
    payload = _extract_json_payload(raw)
    return json.loads(payload)

def _persist_analysis_parse_failure(module: str, new_content: str, raw_content: str, retrieved_docs: List[Dict]) -> None:
    log_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "../runtime_logs"))
    os.makedirs(log_dir, exist_ok=True)
    log_path = os.path.join(log_dir, "analysis_parse_failures.jsonl")
    record = {
        "trace_id": str(uuid.uuid4()),
        "timestamp": datetime.utcnow().isoformat() + "Z",
        "module": module,
        "content_hash": hashlib.md5((new_content or "").encode("utf-8")).hexdigest(),
        "content_preview": (new_content or "")[:800],
        "raw_response_preview": (raw_content or "")[:3000],
        "retrieved_docs": [
            {
                "filename": d.get("filename"),
                "header_path": d.get("header_path"),
                "score": d.get("score"),
                "module": d.get("module"),
                "doc_type": d.get("doc_type", d.get("type")),
            }
            for d in (retrieved_docs or [])[:20]
        ],
    }
    with open(log_path, "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")

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

def _apply_conflict_rule_fallback(result: Dict[str, Any], retrieved_docs: List[Dict]) -> Dict[str, Any]:
    blocks = result.get("blocks") or []
    conflicts = result.get("conflicts") or []
    supp = result.get("supplementaryInfo") or []

    conflict_signal_keywords = ("强制覆盖", "必须", "直接修改业务逻辑", "覆盖业务逻辑")
    evidence_keywords = ("非强制", "参考建议", "可选", "提示评审", "不直接修改业务逻辑", "建议")

    evidence_doc = None
    for d in (retrieved_docs or []):
        text = f"{d.get('filename','')} {d.get('header_path','')} {d.get('content','')}"
        if any(k in text for k in evidence_keywords):
            evidence_doc = d
            break
    if not evidence_doc:
        return result

    source_snippet = (evidence_doc.get("content") or "").strip().replace("\n", " ")
    if len(source_snippet) > 160:
        source_snippet = source_snippet[:160] + "..."
    source_context = (
        f"{evidence_doc.get('filename','未知文件')} / {evidence_doc.get('header_path','未分段')}: "
        f"{source_snippet or '命中到与“非强制建议”相关历史规范'}"
    )
    existing_logic_blocks = {
        (c.get("blockId") or "")
        for c in conflicts
        if (c.get("type") or "").strip() == "logic_conflict"
    }
    for b in blocks:
        block_id = b.get("id") or "b1"
        if block_id in existing_logic_blocks:
            continue
        txt = f"{b.get('originalText','')} {b.get('aiText','')}"
        if not any(k in txt for k in conflict_signal_keywords):
            continue

        conflicts.append({
            "id": f"fallback_logic_{block_id}",
            "blockId": block_id,
            "type": "logic_conflict",
            "severity": "High",
            "description": "检测到“强制覆盖/必须”表述与历史“非强制建议/可选”规范存在潜在冲突（规则兜底）。",
            "sourceContext": source_context,
            "ignored": False
        })

        original = (b.get("originalText") or "").strip()
        ai_text = (b.get("aiText") or "").strip()
        if ai_text == original:
            if "强制覆盖" in ai_text:
                ai_text = ai_text.replace("强制覆盖", "参考建议（非强制）")
            elif "必须" in ai_text:
                ai_text = ai_text.replace("必须", "建议")
            else:
                ai_text = f"{ai_text}（根据历史规范调整为非强制建议）"
            b["aiText"] = ai_text
            b["hasChange"] = ai_text != original

    return {
        "blocks": blocks,
        "conflicts": conflicts,
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
        content = (response.content or "").strip()
        print(f"LLM Raw Response: {content}")
        result = _parse_analysis_json(content)
        sanitized = _sanitize_analysis_result(result, new_content)
        return _apply_conflict_rule_fallback(sanitized, retrieved_docs)
    except json.JSONDecodeError:
        print(f"Failed to parse LLM response: {response.content}")
        try:
            _persist_analysis_parse_failure(module, new_content, response.content or "", retrieved_docs)
        except Exception as log_err:
            print(f"Failed to write parse failure log: {log_err}")
        # Second pass: ask model to repair malformed JSON into strict schema output.
        try:
            repair_prompt = JSON_REPAIR_PROMPT.format(raw=(response.content or "")[:12000])
            repaired = await llm.ainvoke([HumanMessage(content=repair_prompt)])
            repaired_content = (repaired.content or "").strip()
            repaired_json = _parse_analysis_json(repaired_content)
            sanitized = _sanitize_analysis_result(repaired_json, new_content)
            return _apply_conflict_rule_fallback(sanitized, retrieved_docs)
        except Exception:
            pass
        # Final fallback: avoid hard failure in UI.
        return {
            "blocks": [{"id": "b1", "originalText": new_content, "aiText": new_content, "hasChange": False}],
            "conflicts": [],
            "supplementaryInfo": [{
                "id": "s_parse_warn",
                "blockId": "b1",
                "title": "解析提示",
                "content": "本次冲突分析结果格式异常，系统已自动降级处理。请点击重新评审重试。",
                "source": "system"
            }]
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
7) 回答中的关键结论后请标注证据引用，格式为 [S1] / [S2]（对应上下文片段编号）。
8) 若无法给出引用编号，则不要下结论，改为说明“未检索到直接依据”。
9) 不输出推理过程，不输出与问题无关内容。
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

JSON_REPAIR_PROMPT = """你是 JSON 修复助手。请把下方文本修复为严格合法 JSON。
要求：
1) 仅输出 JSON 本体，不要解释，不要 Markdown。
2) 顶层键必须是 blocks/conflicts/supplementaryInfo。
3) 保留原语义，不要新增事实。

待修复文本：
<RAW>
{raw}
</RAW>
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

async def answer_question_async(query: str, retrieved_docs: List[Dict], history: List[Dict] = None) -> str:
    """
    通用知识库问答方法，支持多轮对话上下文。
    """
    # 组装上下文
    context_parts = []
    for i, doc in enumerate(retrieved_docs):
        sid = f"S{i+1}"
        context_parts.append(
            f"--- 片段 {i+1} ({sid}) ---\n来源ID: {sid}\n来源: {doc.get('filename')}\n章节: {doc.get('header_path')}\n检索分数: {doc.get('score')}\n内容: {doc.get('content')}\n"
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
        response = await llm.ainvoke(messages)
        answer = (response.content or "").strip()
        if retrieved_docs and _is_refusal_answer(answer):
            return _extractive_fallback_answer(query, retrieved_docs)
        return answer
    except Exception as e:
        print(f"Error in answer_question: {e}")
        return "抱歉，在生成回答时遇到了服务器错误，请稍后再试。"
