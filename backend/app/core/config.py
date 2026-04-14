import json
from typing import Any, Dict, List, Optional, Union

from pydantic import AnyHttpUrl, EmailStr, PostgresDsn, validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    PROJECT_NAME: str = "RAG Requirement Review Expert"
    API_V1_STR: str = "/api/v1"
    SECRET_KEY: str = "changethiskeyinproduction"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60 * 24 * 8  # 8 days
    
    # CORS
    BACKEND_CORS_ORIGINS: List[AnyHttpUrl] = []

    @validator("BACKEND_CORS_ORIGINS", pre=True)
    def assemble_cors_origins(cls, v: Union[str, List[str]]) -> Union[List[str], str]:
        if isinstance(v, str) and not v.startswith("["):
            return [i.strip() for i in v.split(",")]
        elif isinstance(v, (list, str)):
            return v
        raise ValueError(v)

    POSTGRES_SERVER: str = "db"
    POSTGRES_USER: str = "postgres"
    POSTGRES_PASSWORD: str = "postgres"
    POSTGRES_DB: str = "rag_expert"
    SQLALCHEMY_DATABASE_URI: Optional[str] = None

    @validator("SQLALCHEMY_DATABASE_URI", pre=True)
    def assemble_db_connection(cls, v: Optional[str], values: Dict[str, Any]) -> Any:
        if isinstance(v, str):
            return v
        return PostgresDsn.build(
            scheme="postgresql+asyncpg",
            username=values.get("POSTGRES_USER"),
            password=values.get("POSTGRES_PASSWORD"),
            host=values.get("POSTGRES_SERVER"),
            path=f"{values.get('POSTGRES_DB') or ''}",
        ).unicode_string()
    
    QDRANT_URL: str = "http://qdrant:6333"
    GOOGLE_API_KEY: Optional[str] = None
    GEMINI_API_KEY: Optional[str] = None  # Add this field to allow GEMINI_API_KEY in env
    DASHSCOPE_API_KEY: Optional[str] = None  # Add this field for Qwen embeddings
    SUPER_ADMIN_EMAILS: List[str] = []
    BUSINESS_LINE_MEMBERS: Dict[str, List[str]] = {}

    @validator("SUPER_ADMIN_EMAILS", pre=True)
    def assemble_super_admin_emails(cls, v: Union[str, List[str]]) -> List[str]:
        if isinstance(v, str):
            text = v.strip()
            if not text:
                return []
            if text.startswith("["):
                try:
                    parsed = json.loads(text)
                    if isinstance(parsed, list):
                        return [str(i).strip() for i in parsed if str(i).strip()]
                except Exception:
                    return []
            return [i.strip() for i in text.split(",") if i.strip()]
        if isinstance(v, list):
            return [str(i).strip() for i in v if str(i).strip()]
        return []

    @validator("BUSINESS_LINE_MEMBERS", pre=True)
    def assemble_business_line_members(cls, v: Union[str, Dict[str, List[str]]]) -> Dict[str, List[str]]:
        if isinstance(v, str):
            text = v.strip()
            if not text:
                return {}
            try:
                parsed = json.loads(text)
            except Exception:
                return {}
            if not isinstance(parsed, dict):
                return {}
            out: Dict[str, List[str]] = {}
            for k, val in parsed.items():
                if isinstance(val, list):
                    out[str(k)] = [str(i).strip() for i in val if str(i).strip()]
            return out
        if isinstance(v, dict):
            out: Dict[str, List[str]] = {}
            for k, val in v.items():
                if isinstance(val, list):
                    out[str(k)] = [str(i).strip() for i in val if str(i).strip()]
            return out
        return {}

    class Config:
        case_sensitive = True
        env_file = ".env"

settings = Settings()
