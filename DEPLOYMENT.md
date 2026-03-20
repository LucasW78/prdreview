# 部署到云服务器指南

## 前置要求

- 云服务器（阿里云、腾讯云、AWS 等）
- 服务器已安装 Docker 和 Docker Compose
- 域名（可选，用于 HTTPS）

## 部署步骤

### 1. 准备项目文件

在本地打包前端项目：

```bash
# 进入前端目录
cd /Users/nye/Downloads/rag-requirement-review-expert

# 安装前端依赖
npm install

# 构建生产版本
npm run build
```

### 2. 上传项目到服务器

#### 方法一：使用 Git（推荐）

```bash
# 在本地初始化 Git 仓库（如果还没有）
cd /Users/nye/Downloads/rag-requirement-review-expert
git init
git add .
git commit -m "Initial commit"

# 推送到 GitHub/GitLab 等代码托管平台
git remote add origin <your-repository-url>
git push -u origin main
```

然后在服务器上：

```bash
# 克隆项目
git clone <your-repository-url>
cd rag-requirement-review-expert
```

#### 方法二：使用 SCP 直接上传

```bash
# 在本地打包项目
cd /Users/nye/Downloads/rag-requirement-review-expert
tar -czf rag-project.tar.gz --exclude='node_modules' --exclude='.git' --exclude='uploads' --exclude='dist' .

# 上传到服务器
scp rag-project.tar.gz user@your-server-ip:/path/to/deploy/

# 在服务器上解压
ssh user@your-server-ip
cd /path/to/deploy
tar -xzf rag-project.tar.gz
```

### 3. 配置环境变量

在服务器上创建 `.env` 文件：

```bash
cd /path/to/deploy/rag-requirement-review-expert
cp backend/.env.example backend/.env
nano backend/.env
```

编辑 `backend/.env` 文件，配置以下内容：

```env
POSTGRES_SERVER=db
POSTGRES_USER=postgres
POSTGRES_PASSWORD=your_secure_password_here
POSTGRES_DB=rag_expert
GEMINI_API_KEY=your_gemini_api_key_here
DASHSCOPE_API_KEY=your_dashscope_api_key_here
SECRET_KEY=your_secure_secret_key_here
```

**重要提示：**
- 请修改所有密码和密钥为安全的值
- 不要将包含真实密钥的 `.env` 文件提交到 Git

### 4. 修改 Docker Compose 配置

编辑 `docker-compose.yml` 文件，为生产环境做调整：

```yaml
version: "3.8"

services:
  db:
    image: postgres:15-alpine
    restart: always
    environment:
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=rag_expert
    ports:
      - "127.0.0.1:5432:5432"  # 只绑定到本地，不对外暴露
    volumes:
      - postgres_data:/var/lib/postgresql/data

  qdrant:
    image: qdrant/qdrant:latest
    restart: always
    ports:
      - "127.0.0.1:6333:6333"  # 只绑定到本地
    volumes:
      - qdrant_data:/qdrant/storage

  backend:
    build:
      context: ./backend
      dockerfile: Dockerfile
    restart: always
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000
    ports:
      - "127.0.0.1:8000:8000"  # 只绑定到本地
    environment:
      - POSTGRES_SERVER=db
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
      - POSTGRES_DB=rag_expert
      - QDRANT_URL=http://qdrant:6333
      - SECRET_KEY=${SECRET_KEY}
      - GOOGLE_API_KEY=${GEMINI_API_KEY}
    depends_on:
      - db
      - qdrant

  # 添加 Nginx 作为反向代理（可选但推荐）
  nginx:
    image: nginx:alpine
    restart: always
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf:ro
      - ./dist:/usr/share/nginx/html:ro
      - ./ssl:/etc/nginx/ssl:ro
    depends_on:
      - backend

volumes:
  postgres_data:
  qdrant_data:
```

### 5. 创建 Nginx 配置（可选但推荐）

创建 `nginx.conf` 文件：

```nginx
events {
    worker_connections 1024;
}

http {
    include       /etc/nginx/mime.types;
    default_type  application/octet-stream;

    server {
        listen 80;
        server_name your-domain.com;

        # 前端静态文件
        location / {
            root /usr/share/nginx/html;
            try_files $uri $uri/ /index.html;
        }

        # 后端 API 代理
        location /api/ {
            proxy_pass http://backend:8000;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }
    }

    # HTTPS 配置（需要 SSL 证书）
    # server {
    #     listen 443 ssl http2;
    #     server_name your-domain.com;
    #
    #     ssl_certificate /etc/nginx/ssl/fullchain.pem;
    #     ssl_certificate_key /etc/nginx/ssl/privkey.pem;
    #
    #     location / {
    #         root /usr/share/nginx/html;
    #         try_files $uri $uri/ /index.html;
    #     }
    #
    #     location /api/ {
    #         proxy_pass http://backend:8000;
    #         proxy_set_header Host $host;
    #         proxy_set_header X-Real-IP $remote_addr;
    #         proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    #         proxy_set_header X-Forwarded-Proto $scheme;
    #     }
    # }
    #
    # # HTTP 重定向到 HTTPS
    # server {
    #     listen 80;
    #     server_name your-domain.com;
    #     return 301 https://$server_name$request_uri;
    # }
}
```

### 6. 启动服务

```bash
# 在服务器项目目录下
cd /path/to/deploy/rag-requirement-review-expert

# 构建并启动所有服务
docker-compose up -d --build

# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
```

### 7. 初始化数据库

```bash
# 进入后端容器
docker-compose exec backend bash

# 运行数据库迁移
alembic upgrade head

# 退出容器
exit
```

### 8. 配置防火墙

如果使用云服务器，需要开放相应端口：

```bash
# Ubuntu/Debian 使用 ufw
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
sudo ufw enable

# CentOS 使用 firewalld
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --reload
```

### 9. 验证部署

在浏览器中访问：
- 前端：`http://your-server-ip` 或 `http://your-domain.com`
- 后端 API 文档：`http://your-server-ip/api/docs`

## 常用运维命令

```bash
# 查看服务状态
docker-compose ps

# 查看日志
docker-compose logs -f
docker-compose logs -f backend
docker-compose logs -f db

# 停止服务
docker-compose stop

# 启动服务
docker-compose start

# 重启服务
docker-compose restart

# 停止并删除容器
docker-compose down

# 停止并删除容器和数据卷（谨慎使用！）
docker-compose down -v

# 更新代码后重新部署
git pull
docker-compose up -d --build
docker-compose exec backend alembic upgrade head
```

## 备份数据

定期备份数据库和上传的文件：

```bash
# 备份数据库
docker-compose exec db pg_dump -U postgres rag_expert > backup_$(date +%Y%m%d).sql

# 备份上传的文件
tar -czf uploads_backup_$(date +%Y%m%d).tar.gz backend/uploads/

# 备份 Qdrant 数据
docker-compose exec qdrant tar -czf /qdrant/backup_$(date +%Y%m%d).tar.gz /qdrant/storage
docker cp $(docker-compose ps -q qdrant):/qdrant/backup_$(date +%Y%m%d).tar.gz .
```

## 安全建议

1. **不要在 Git 中提交 .env 文件**
2. **使用强密码和密钥**
3. **定期更新 Docker 镜像**
4. **配置 HTTPS**
5. **限制数据库端口只对内暴露**
6. **定期备份数据**
7. **监控服务器资源使用情况**

## 故障排查

### 前端无法连接后端
- 检查 Nginx 配置
- 检查后端容器是否正常运行：`docker-compose ps`
- 查看后端日志：`docker-compose logs backend`

### 数据库连接失败
- 检查数据库容器状态
- 检查环境变量配置
- 查看数据库日志：`docker-compose logs db`

### 上传文件丢失
- 检查 `uploads` 目录权限
- 确保 Docker volume 正确挂载
