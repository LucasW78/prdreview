# RAG Requirement Review Expert

面向 PRD/SOP 的需求评审与知识问答平台，核心流程是：
1. 先将历史文档入库（结构化切分 + 向量化）
2. 对新需求做冲突分析与优化建议
3. Merge 后归档为最终版本并回写知识库
4. 在问答页基于知识库进行检索问答

## 功能模块

### 评审工作台
- 支持输入需求文本并发起智能评审
- 输出冲突卡片、规范建议、完善建议
- 支持报告卡片点击联动原文定位高亮（冲突/规范建议）
- 支持原始需求文档在线编辑、二次确认后导入知识库
- 支持异步任务快照、重新评审、取消即删除、Merge 结果弹窗
- 保存快照后自动回到空态待上传页面
- 导入成功后可直接跳转到对应知识库查看

### 知识库管理
- PRD / SOP 双 Tab 管理
- 上传、分页查询、预览、删除
- 按模块和关键词检索历史文档
- 入库按 `module + doc_type + content_hash` 去重，避免 SOP/PRD 互相误判重复

### 智能问答
- 基于知识库检索后回答问题
- Gemini 风格会话交互（左侧历史 + 右侧会话）
- 支持新建会话、重命名、删除、清空全部、刷新后本地持久化
- 支持中断请求、AI 回复重新生成
- 当回答无知识依据时自动隐藏参考来源
- 支持证据引用编号（如 `[S1]`）与来源卡片联动展示

### 提示词管理
- 独立侧边栏模块入口
- 回显“评审工作台”系统提示词
- 支持编辑、重置与一键应用

### 权限管理
- 超级管理员：全页面全功能
- 业务线角色：仅知识库上传/查询，且仅可访问所属模块
- 支持在线维护权限配置（超级管理员名单、业务线名单）

## 技术栈

- 前端：React + TypeScript + Vite + TailwindCSS + Axios
- 后端：FastAPI + SQLAlchemy(Async) + PostgreSQL
- 向量检索：Qdrant
- LLM/Embedding：DashScope（Qwen）

## 系统要求

- Node.js 18+
- Docker / Docker Compose
- 可用的 DashScope API Key（用于冲突分析和向量化）

## 快速启动（推荐）

### 1) 安装前端依赖

```bash
npm install
```

### 2) 配置后端环境变量

在 `backend/.env` 中至少配置以下变量：

```env
POSTGRES_SERVER=db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=postgres
POSTGRES_DB=rag_expert
QDRANT_URL=http://qdrant:6333
DASHSCOPE_API_KEY=your_dashscope_api_key
SECRET_KEY=change_me
SUPER_ADMIN_EMAILS=admin@company.com,cto@company.com
BUSINESS_LINE_MEMBERS={"支付模块":["pay1@company.com"],"任务调度":["ops1@company.com"]}
```

### 3) 启动后端基础服务

```bash
docker-compose up --build -d
```

### 4) 启动前端

```bash
npm run dev
```

### 5) 访问地址

- 前端：http://localhost:3000
- 后端 OpenAPI：http://localhost:8000/docs

## 本地开发（可选）

如果你不想把后端跑在 Docker 容器里：

```bash
docker-compose up db qdrant -d
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

## 关键接口

- `POST /api/v1/review/analyze`：需求冲突分析
- `POST /api/v1/review/merge/{task_id}`：确认 Merge 并归档
- `GET /api/v1/review/tasks`：评审任务列表
- `POST /api/v1/review/tasks/{task_id}/rerun`：原任务重新评审
- `POST /api/v1/review/tasks/{task_id}/snapshots`：保存评审快照
- `DELETE /api/v1/review/tasks/{task_id}`：删除评审任务
- `GET /api/v1/review/system-prompt`：获取评审系统提示词
- `PUT /api/v1/review/system-prompt`：更新评审系统提示词
- `GET /api/v1/review/analysis-parse-failures`：查询评审解析失败日志
- `POST /api/v1/ingestion/upload`：上传文档入库
- `GET /api/v1/ingestion/history`：知识库分页查询
- `GET /api/v1/ingestion/document/{id}`：文档内容预览
- `DELETE /api/v1/ingestion/document/{id}`：删除文档
- `POST /api/v1/chat/ask`：检索增强问答
- `GET /api/v1/auth/permissions`：获取当前用户权限
- `GET /api/v1/auth/permission-config`：获取权限配置（仅超管）
- `PUT /api/v1/auth/permission-config`：更新权限配置（仅超管）

## 目录结构

```text
src/
  App.tsx
  api.ts
  components/
    Sidebar.tsx
    ReviewWorkbench.tsx
    KnowledgeBase.tsx
    KnowledgeChat.tsx
    PromptManagement.tsx
    DataIngestion.tsx

backend/
  app/
    api/v1/endpoints/
      review.py
      ingestion.py
      chat.py
    services/
      llm_service.py
      rag_service.py
    core/
      config.py
  Dockerfile
  requirements.txt
```

## 常见问题

### 1) Merge 失败
- 先看前端弹窗里的具体错误信息
- 检查 `task_id` 是否有效、Merge 内容是否为空
- 若提示索引失败，表示归档成功但知识库向量化失败，通常是 DashScope/Qdrant 连通性问题

### 2) 前端请求不到后端
- 当前前端默认请求 `http://localhost:8000/api/v1`（见 `src/api.ts`）
- 请确认后端服务地址与端口一致

## 版本说明

- `v0.1.4` 更新内容见 [更新说明.md](./更新说明.md)

## License

MIT
