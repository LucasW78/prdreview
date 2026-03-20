from pydantic import BaseModel
from typing import List, Optional

class ReviewRequest(BaseModel):
    module: str
    content: str
    sop_ids: Optional[List[str]] = []

class ConflictItem(BaseModel):
    id: str
    type: str  # 'conflict' or 'sop'
    description: str
    ignored: bool = False
    blockId: str
    severity: Optional[str] = "Medium"
    sourceContext: Optional[str] = None

class DocBlockItem(BaseModel):
    id: str
    originalText: str
    aiText: str
    hasChange: bool
    changeType: Optional[str] = "none"

class SupplementaryInfoItem(BaseModel):
    id: str
    blockId: str
    title: str
    content: str
    source: Optional[str] = None

class ReviewResponse(BaseModel):
    task_id: int
    module: str
    blocks: List[DocBlockItem]
    conflicts: List[ConflictItem]
    supplementaryInfo: Optional[List[SupplementaryInfoItem]] = []
    processing_time_sec: float
