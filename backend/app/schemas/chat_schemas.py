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
    filename: str
    content: str
    score: float
    module: str

class ChatResponse(BaseModel):
    answer: str
    sources: List[SourceDoc]
