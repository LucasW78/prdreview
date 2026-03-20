# RAG Requirement Review Expert - Backend

## Setup

1.  **Prerequisites**:
    *   Docker & Docker Compose
    *   Python 3.11+

2.  **Environment Variables**:
    *   Copy `.env.example` to `.env`
    *   Set your `GEMINI_API_KEY`

3.  **Run with Docker**:
    ```bash
    docker-compose up --build
    ```

4.  **Run Locally (Development)**:
    *   Start DBs: `docker-compose up db qdrant -d`
    *   Install deps: `pip install -r requirements.txt`
    *   Run app: `uvicorn app.main:app --reload`

## API Documentation
Once running, visit: http://localhost:8000/docs
