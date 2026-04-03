# RAG Requirement Review Expert

面向 PRD / SOP 的 RAG 评审与问答平台，提供三大能力：
- 需求冲突分析（评审工作台）
- 知识库管理（上传 / 查询 / 预览 / 删除 / 分页）
- 智能问答（基于知识库检索 + 引用来源展示）

## 本次代码重构说明

已完成一轮全量 CR（前后端模块引用关系扫描）：
- 未发现可安全删除的“整文件未引用模块”
- 清理了确认无用的死导入
- 移除了前端不可达页面态：`ingestion` 顶层 Tab（实际入口在知识库上传弹窗）

## 功能概览

### 1) 评审工作台
- 输入新需求内容
- 结合历史文档检索结果进行冲突分析
- 输出修改建议、冲突项、补充信息

### 2) 知识库管理
- PRD / SOP 双 Tab 管理
- 条件查询：模块 + 关键词
- 分页展示：每页 6 条
- 在线预览、删除文档
- 上传文档后自动入库（元数据 + 向量）

### 3) 智能问答
- 基于检索文档回答问题
- 展示参考来源和匹配分数
- 支持中止请求

## 技术栈

### 前端
- React 18 + Vite + TypeScript
- TailwindCSS + Lucide
- Axios

### 后端
- FastAPI
- SQLAlchemy (Async) + PostgreSQL
- Qdrant
- LangChain + DashScope(Qwen)

## 快速启动

### 1. 安装前端依赖
```bash
npm install
```

### 2. 配置环境变量
在项目根目录创建 `.env`：

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/prd_review
QDRANT_HOST=localhost
QDRANT_PORT=6333
DASHSCOPE_API_KEY=your_dashscope_api_key_here
```

### 3. 启动后端（Docker）
```bash
docker-compose up --build -d
```

### 4. 启动前端
```bash
npm run dev
```

- 前端：http://localhost:3000
- 后端文档：http://localhost:8000/docs

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

backend/app/
  api/v1/endpoints/
    review.py
    ingestion.py
    chat.py
    auth.py
  services/
    llm_service.py
    rag_service.py
    user_service.py
  schemas/
  models/
```

## 核心接口

- `POST /api/v1/review/analyze`：需求冲突分析
- `POST /api/v1/ingestion/upload`：上传文档
- `GET /api/v1/ingestion/history`：知识库列表（含分页）
- `GET /api/v1/ingestion/document/{id}`：文档预览
- `DELETE /api/v1/ingestion/document/{id}`：删除文档
- `POST /api/v1/chat/ask`：知识库问答

## License

MIT
