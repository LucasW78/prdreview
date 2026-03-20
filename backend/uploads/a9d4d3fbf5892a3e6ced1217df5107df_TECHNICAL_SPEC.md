# 业务 RAG 需求评审专家系统 - 技术规格说明书 (Technical Specification)

**版本**: V1.1 (正式交付版)  
**角色**: 资深产品经理 Gemini  
**日期**: 2026-03-14

---

## 1. 项目背景与目标 (Background & Objectives)

### 1.1 背景
针对当前产研测协作中普遍存在的痛点：
*   **文档碎片化**: 需求散落在不同版本、不同格式的文档中，难以追溯。
*   **业务逻辑冲突**: 新需求往往与旧逻辑存在潜在矛盾，人工评审容易遗漏。
*   **SOP 规范缺失**: 开发过程中常常忽略埋点、异常流处理等标准操作程序 (SOP)。

### 1.2 目标
构建基于 **RAG (检索增强生成)** 的智能评审系统。通过将新需求与存量知识库（PRD + SOP）进行深度比对，实现：
1.  **风险预警**: 自动识别新旧逻辑冲突。
2.  **版本闭环**: 确保需求变更的可追溯性和一致性。
3.  **规范落地**: 强制校验 SOP 执行情况。

---

## 2. 系统总体架构 (System Architecture)

系统采用典型的 **微服务 + 异步流水线** 架构，确保长文本处理的稳定性与可扩展性。

### 2.1 核心组件选型

| 组件层级 | 技术选型 | 选型理由 |
| :--- | :--- | :--- |
| **前端 (Frontend)** | React 19 + Tailwind CSS + Lucide Icon | 实现“三段式工作台”布局，提供流畅的交互体验。 |
| **网关/API (Gateway)** | FastAPI (Python 3.11+) | 高性能异步框架，天然适配 AI/LLM 生态。 |
| **大模型编排 (Orchestration)** | LangGraph | 相比 LangChain，更适合处理带有“人工干预回环” (Human-in-the-loop) 的 Merge 工作流。 |
| **向量数据库 (Vector DB)** | Qdrant | 支持复杂的 Payload 过滤和元数据更新，适合混合检索。 |
| **搜索引擎 (Search Engine)** | Elasticsearch | 用于精确的关键词/实体匹配，弥补向量检索在特定术语上的不足。 |
| **LLM 基座** | Gemini 1.5 Pro (推荐) | 长上下文窗口优势，适合处理长文档对比。 |

### 2.2 数据处理流水线 (Data Pipeline)

为了实现“基于 Markdown 标题层级的语义切片”，开发需遵循以下逻辑：

1.  **解析层 (Parsing)**: 使用 `MarkdownHeaderTextSplitter` 对文档进行结构化切分。
2.  **上下文增强 (Context Enrichment)**: 每一个 Chunk 必须包含其完整的标题路径（例如：`[支付模块 > 自动续费 > 扣款异常流]`），保留父子层级关系。
3.  **元数据注入 (Metadata Injection)**:
    *   `upload_time`: 用于计算时间权重 ($Time\_Weight$)。
    *   `biz_module`: 用于命名空间隔离（如“支付”、“用户中心”）。

---

## 3. 系统功能模块设计 (Functional Modules)

### 3.1 数据投喂模块 (Data Ingestion) - “真理之源”

*   **PRD 知识库上传**:
    *   支持 `.docx`, `.pdf`, `.md` 批量上传。
    *   **强制元数据**: 必须标记“业务模块”。
    *   **版本控制**: 自动识别重复文档，记录上传时间戳。
*   **SOP 规范库上传**:
    *   存放通用规范（如：埋点、异常流）。
    *   **逻辑**: 作为评审时的“参考建议”，具备提示权重，但不具备强制覆盖性。

### 3.2 评审引擎模块 (Logic Engine) - 核心大脑

*   **核心算法**: `Similarity * Time_Weight`
*   **冲突检测**:
    *   重点针对 **【策略】** 与 **【任务】** 实体进行跨文档关联。
    *   结合 NER (命名实体识别) 提取同一实体的不同定义，发现矛盾项。
*   **SOP 校验**:
    *   扫描新需求是否包含 SOP 定义的必要分支（如：异常处理、埋点记录）。
    *   使用 **Few-shot Prompting** 提供明确规范示例，防止 AI 幻觉。

### 3.3 交互设计方案 (Interaction Design)

采用 **“三段式工作台”** 布局，强调 PM 的决策主导权。

#### 3.3.1 核心评审工作台 (Review Workbench)
1.  **上方（信息区）**: 显示当前评审任务、所属模块、引用的 SOP 版本。
2.  **中部（Diff 区）**:
    *   **左栏（只读）**: 原始上传的需求文档。
    *   **右栏（编辑）**: AI 优化后的需求文档。对增/删/改内容进行高亮标注，支持 PM 直接修改。
3.  **下方（详情区）**:
    *   **冲突卡片**: 展示具体逻辑冲突点（如：“此策略参数与《历史文档 A》互斥”）。
    *   **动作**: 提供 “忽略” 勾选框。勾选后，右栏对应的高亮标注自动消失。

#### 3.3.2 Merge 确认工作流
1.  **点击 Merge**: 位于工作台右下角。
2.  **二次编辑弹窗**: 全屏预览合并修改后的“干净文本”（无标注状态）。
3.  **确认覆盖**: PM 微调后点击“确认”。
4.  **数据回填**: 系统将终稿存为该需求的新版本，并异步更新向量数据库索引。

---

## 4. 核心算法与逻辑细节 (Core Algorithms)

### 4.1 冲突检测引擎 (Conflict Detection Engine)

建议采用 **混合搜索 + 逻辑推演** 模式：

#### Step 1: 召回 (Recall)
1.  根据新需求的 `biz_module` 缩小检索范围。
2.  通过 **向量相似度** 召回 Top 5 相关背景文档。
3.  通过 **BM25 算法** 根据关键实体（如“退款状态”）召回存量 SOP 规范。

#### Step 2: 逻辑冲突分析 (Analysis)
*   **Prompt 策略**: 采用 **Chain-of-Thought (CoT)**。
    1.  提取旧文档的约束条件。
    2.  提取新文档的变更点。
    3.  对比二者是否存在互斥。

#### Step 3: 判定公式
$$Score = (Similarity \cdot Time\_Weight) + Entity\_Match\_Bonus$$

*   **时间权重 ($Time\_Weight$)**: 最新 PRD 权重为 1.0，随月份递减，确保系统不会被旧逻辑误导。
*   **知识库隔离**: 检索仅限于用户指定的“业务模块”命名空间。

---

## 5. 数据库设计 (Database Schema)

### 5.1 关系型数据库 (PostgreSQL)
用于版本控制和任务状态管理。

| 表名 | 关键字段 | 说明 |
| :--- | :--- | :--- |
| `docs_metadata` | `id`, `filename`, `module`, `version`, `is_latest` | 维护真理之源的版本 |
| `review_tasks` | `id`, `origin_content`, `optimized_content`, `status` | 评审任务流转状态 |
| `conflict_cards` | `id`, `task_id`, `conflict_type`, `description`, `is_ignored` | 存储冲突点及 PM 忽略状态 |

### 5.2 向量数据库 (Qdrant)
*   **Collection 名称**: `prd_knowledge_base`
*   **Payload 结构**:
    ```json
    {
      "module": "string",
      "timestamp": "int",
      "text_content": "string"
    }
    ```

---

## 6. 关键接口定义 (API Specification)

### 6.1 提交评审任务
*   **Endpoint**: `POST /v1/review/analyze`
*   **Payload**:
    ```json
    {
      "module": "交易中心",
      "content": "# 需求详情...",
      "sop_ids": ["sop_001"]
    }
    ```

### 6.2 Merge 确认回填
*   **Endpoint**: `POST /v1/review/merge`
*   **Logic**:
    1.  更新 `docs_metadata`，将旧版本 `is_latest` 置为 `false`。
    2.  触发向量库重刷任务，删除该 module 下旧版本的向量，插入 Merge 后的新文本向量。

---

## 7. 非功能性需求 (Non-functional Requirements)

1.  **响应速度**: 评审报告生成 $\le 30s$。建议引入 Redis 缓存常用 SOP。
2.  **数据安全**: 模块化物理隔离，文档分级存储。
3.  **准确率**: P0 级逻辑冲突（如状态机互斥）召回率需 $> 90\%$。
4.  **Token 消耗控制**: 强制开启 **语义缓存 (Semantic Cache)** 以降低成本。

---

## 8. 实施路线图 (Roadmap)

*   **Phase 1 (W1-W2): 基础 RAG 搭建**
    *   实现 PDF/Docx 解析及向量入库。
    *   支持基础语义检索。
*   **Phase 2 (W3-W4): 冲突引擎开发**
    *   调优逻辑判定 Prompt。
    *   实现三段式 UI 的 Diff 高亮渲染。
*   **Phase 3 (W5): 性能优化**
    *   引入 Redis 缓存。
    *   实现 $Time\_Weight$ 衰减算法。
    *   确保响应 $\le 30s$。

---

## 9. 架构师风险提示

1.  **Token 消耗**: 大规模对比会消耗大量 Token。建议开发阶段强制开启语义缓存。
2.  **幻觉控制**: 针对“SOP 校验”模块，必须使用 Few-shot Prompting 提供明确的规范示例，防止 AI 编造不存在的规范。
