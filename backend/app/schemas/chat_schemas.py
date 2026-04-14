from pydantic import BaseModel
from typing import List, Optional

class Message(BaseModel):
    role: str  # "user" or "assistant"
    content: str

class ChatRequest(BaseModel):
    query: str
    module: str = "全部"
    history: List[Message] = []

class SourceDoc(BaseModel):
    id: Optional[int] = None
    source_id: Optional[str] = None
    filename: str
    header_path: Optional[str] = None
    content: str
    score: float
    module: str
    doc_type: Optional[str] = None

class ChatResponse(BaseModel):
    answer: str
    sources: List[SourceDoc]
