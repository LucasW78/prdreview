# 《业务 RAG 需求评审专家系统》执行计划 (Execution Plan)

基于 `docs/PRD.md` 和 `docs/TECHNICAL_SPEC.md`，结合现有 React 前端原型，制定以下实施计划。本计划旨在将现有的 UI 原型转化为功能完整的 RAG 评审系统。

**执行角色**: 全栈开发 (前端 React + 后端 Python/FastAPI)
**预估周期**: 4-5 周 (Phase 1 - Phase 4)

---

## Phase 1: 基础设施与后端框架搭建 (Infrastructure & Backend Foundation)
**目标**: 建立前后端联调的基础环境，实现数据库连接和基础 API。

### 1.1 后端环境初始化
- [ ] **项目结构搭建**: 创建 `backend/` 目录，初始化 FastAPI 项目结构。
- [ ] **依赖管理**: 配置 `requirements.txt` (FastAPI, Uvicorn, SQLAlchemy, Pydantic, Qdrant-client, LangChain/LangGraph, Google-GenAI)。
- [ ] **Docker 环境**: 编写 `docker-compose.yml`，编排 PostgreSQL (元数据存储) 和 Qdrant (向量存储)。

### 1.2 数据库设计与实现
- [ ] **SQL Schema**: 根据 Tech Spec 设计 `docs_metadata`, `review_tasks`, `conflict_cards` 表结构 (使用 SQLAlchemy 模型)。
- [ ] **Vector Schema**: 初始化 Qdrant Collection `prd_knowledge_base`，定义 Payload 结构 (`module`, `timestamp`, `text_content`)。
- [ ] **Migration**: 配置 Alembic 进行数据库版本管理。

### 1.3 基础接口开发 (API v0.1)
- [ ] `POST /api/upload`: 文件上传接口 (暂存本地/S3，写入 `docs_metadata`)。
- [ ] `GET /api/modules`:以此获取系统支持的业务模块列表 (用于前端下拉菜单)。
- [ ] `GET /api/health`: 系统健康检查接口。

**交付物**: 可运行的后端服务，Swagger API 文档，Docker 化的数据库环境。

---

## Phase 2: RAG 核心引擎开发 (RAG Engine Core)
**目标**: 实现文档解析、入库、检索和 LLM 冲突检测逻辑。

### 2.1 数据处理流水线 (Data Pipeline)
- [ ] **文档解析**: 集成 `MarkdownHeaderTextSplitter` (LangChain) 解析 Markdown/文本文件。
- [ ] **元数据增强**: 实现 Chunking 逻辑，注入 `upload_time` 和 `biz_module`，保留标题路径上下文。
- [ ] **向量化与存储**: 使用 Embedding 模型 (如 OpenAI/Gemini Embedding) 将 Chunk 向量化并存入 Qdrant。

### 2.2 检索增强 (Retrieval)
- [ ] **混合检索**: 实现 Qdrant 的 Hybrid Search (向量相似度 + 关键词匹配)。
- [ ] **时间权重算法**: 在检索逻辑中实现 $Score = (Similarity \cdot Time\_Weight)$ 公式，对旧文档降权。
- [ ] **SOP 召回**: 实现基于 BM25 的 SOP 规范文档检索。

### 2.3 冲突检测引擎 (Conflict Engine)
- [ ] **Prompt Engineering**: 设计 Chain-of-Thought (CoT) Prompt，用于对比新旧文档冲突。
- [ ] **LLM 集成**: 接入 Gemini 1.5 Pro API，封装冲突检测服务。
- [ ] **接口实现**: 开发 `POST /api/review/analyze` 接口，接收新需求，返回 Diff 文本和冲突列表。

**交付物**: 能够根据输入文本返回冲突点和优化建议的 API。

---

## Phase 3: 前端功能对接与深度开发 (Frontend Integration)
**目标**: 将现有 Mock UI 对接真实后端，实现完整业务闭环。

### 3.1 数据投喂模块对接
- [ ] **PRD 上传**: 改造 `DataIngestion.tsx`，对接 `/api/upload` 接口，支持真实文件上传与进度显示。
- [ ] **SOP 上传**: 实现 SOP 文件的分类上传与入库。

### 3.2 评审工作台对接
- [ ] **任务发起**: 在上传页增加“开始评审”按钮，调用 `/api/review/analyze`。
- [ ] **Diff 渲染**: 改造 `ReviewWorkbench.tsx`，使用真实 API 返回的 `originalText` 和 `aiText` 渲染 Diff。
- [ ] **冲突卡片**: 动态渲染 API 返回的冲突列表 (`Conflict[]`)，实现点击高亮联动。

### 3.3 Merge 确认工作流
- [ ] **交互实现**: 完善 Merge Modal 的全屏编辑功能。
- [ ] **回填接口**: 开发前端调用 `POST /api/review/merge`，实现最终文档的版本回写。

**交付物**: 功能完整的 Web 端应用，支持从上传到评审再到归档的全流程。

---

## Phase 4: 优化与验收 (Optimization & QA)
**目标**: 提升系统性能，确保非功能性需求达标。

### 4.1 性能优化
- [ ] **语义缓存**: 引入 Redis/GPTCache，缓存高频查询的 Embedding 和 LLM 结果。
- [ ] **异步处理**: 确保耗时的分析任务通过 Celery/BackgroundTasks 异步执行，前端通过轮询或 WebSocket 获取状态。

### 4.2 质量保证
- [ ] **SOP 幻觉测试**: 构建测试集，验证系统是否会编造不存在的 SOP。
- [ ] **准确率验证**: 使用已知冲突的测试文档集，评估召回率。

### 4.3 部署与文档
- [ ] **Docker Compose**: 完善全栈容器化配置 (Frontend + Backend + DBs)。
- [ ] **README 更新**: 编写详细的部署指南和使用手册。

---

## 任务优先级排序 (Priority)

1.  **P0**: 后端环境搭建 (Phase 1.1, 1.2)
2.  **P0**: 文档解析与向量入库 (Phase 2.1)
3.  **P0**: 基础冲突检测 API (Phase 2.3)
4.  **P0**: 前端核心页面对接 (Phase 3.2)
5.  **P1**: Merge 回填逻辑 (Phase 3.3)
6.  **P1**: 时间权重算法 (Phase 2.2)
7.  **P2**: 性能优化与缓存 (Phase 4.1)
