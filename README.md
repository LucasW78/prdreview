# RAG Requirement Review Expert

基于 RAG 技术的需求评审知识库平台，支持 PRD/SOP 文档管理、智能问答与需求冲突检测。

## 功能模块

### 1. 评审工作台
上传 PRD/SOP 文档，AI 自动分析新旧需求之间的逻辑冲突、SOP 缺失和补充建议，以可视化卡片呈现。

### 2. 知识库管理
- **PRD 知识库** / **SOP 知识库**：分 Tab 管理两类文档
- 支持按模块、关键词搜索，手动触发查询
- 分页展示（每页 6 条），支持在线预览和删除
- 文档上传自动向量化入库

### 3. 智能问答
- 基于 RAG 检索的私域知识库问答
- **多轮对话上下文管理**：Query Rewrite 自动将指代性问题重写为独立查询，提升检索召回率
- 参考来源悬浮展示，点击可跳转至知识库对应文档
- 流式输出，打字机式阅读体验

## 技术栈

### 前端
- **React 18** + **Vite** + **TypeScript**
- **TailwindCSS** + **Lucide Icons**
- **Axios** + 原生 Fetch（SSE 流式）

### 后端
- **FastAPI** (Python 3.11)
- **SQLAlchemy** (AsyncSession) + **PostgreSQL**
- **Qdrant** 向量数据库
- **LangChain** + **DashScope** (Qwen-plus)
- Docker Compose 一键部署

## 快速启动

### 前端

```bash
cd rag-requirement-review-expert
npm install
npm run dev
```

> 访问 http://localhost:3000

### 后端（Docker）

```bash
docker-compose up --build -d
```

> API 文档：http://localhost:8000/docs

### 环境变量

在项目根目录创建 `.env` 文件：

```env
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/prd_review
QDRANT_HOST=localhost
QDRANT_PORT=6333
DASHSCOPE_API_KEY=your_dashscope_api_key_here
```

## 项目结构

```
rag-requirement-review-expert/
├── src/                          # 前端源码
│   ├── api.ts                    # API 封装
│   ├── App.tsx                   # 根组件（路由 + 状态保留）
│   └── components/
│       ├── DataIngestion.tsx     # 文档上传组件
│       ├── KnowledgeBase.tsx     # 知识库管理（分页 + 查询）
│       ├── KnowledgeChat.tsx     # 智能问答（流式 + 来源跳转）
│       └── ReviewWorkbench.tsx   # 评审工作台
├── backend/
│   ├── app/
│   │   ├── api/v1/endpoints/    # FastAPI 路由
│   │   │   ├── chat.py           # 问答接口（含 Query Rewrite）
│   │   │   ├── ingestion.py      # 文档上传/删除/历史查询（含分页）
│   │   │   └── review.py          # 冲突分析接口
│   │   ├── services/
│   │   │   ├── llm_service.py    # LLM 调用（ChatTongyi + 提示词管理）
│   │   │   └── rag_service.py    # Qdrant 向量检索
│   │   ├── schemas/              # Pydantic 模型
│   │   └── models/               # SQLAlchemy 模型
│   ├── uploads/                  # 文档存储目录
│   └── requirements.txt
└── docker-compose.yml
```

## 核心接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/v1/chat/ask` | POST | RAG 问答（含流式响应） |
| `/api/v1/ingestion/upload` | POST | 上传文档并向量化 |
| `/api/v1/ingestion/history` | GET | 查询文档列表（支持分页+条件过滤） |
| `/api/v1/ingestion/document/{id}` | GET | 读取文档内容 |
| `/api/v1/ingestion/document/{id}` | DELETE | 删除文档（文件+元数据+向量） |
| `/api/v1/ingestion/modules` | GET | 获取模块列表 |
| `/api/v1/review/analyze` | POST | PRD/SOP 冲突分析 |

## License

MIT
