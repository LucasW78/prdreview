# RAG Requirement Review Expert

面向 PRD/SOP 的需求评审与知识问答平台，核心流程是：
1. 先将历史文档入库（结构化切分 + 向量化）
2. 对新需求做冲突分析与优化建议
3. Merge 后归档为最终版本并回写知识库
4. 在问答页基于知识库进行检索问答

## 功能模块

### 评审工作台
- 支持输入需求文本并发起智能评审
- 输出冲突卡片、优化内容、补充信息
- 支持忽略冲突、编辑优化稿、二次确认后 Merge
- Merge 归档文件命名为 `${需求标题}.md`

### 知识库管理
- PRD / SOP 双 Tab 管理
- 上传、分页查询、预览、删除
- 按模块和关键词检索历史文档

### 智能问答
- 基于知识库检索后回答问题
- 返回参考来源与匹配分数
- 支持中断请求

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
- `POST /api/v1/ingestion/upload`：上传文档入库
- `GET /api/v1/ingestion/history`：知识库分页查询
- `GET /api/v1/ingestion/document/{id}`：文档内容预览
- `DELETE /api/v1/ingestion/document/{id}`：删除文档
- `POST /api/v1/chat/ask`：检索增强问答

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

- `v0.1.1` 更新内容见 [更新说明.md](./更新说明.md)

## License

MIT
