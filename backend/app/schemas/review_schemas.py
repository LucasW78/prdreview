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

class ReviewSubmitResponse(BaseModel):
    task_id: int
    module: str
    status: str

class ReviewSnapshotItem(BaseModel):
    task_id: int
    module: str
    status: str
    processing_time_sec: Optional[float] = None
    blocks: List[DocBlockItem] = []
    conflicts: List[ConflictItem] = []
    supplementaryInfo: Optional[List[SupplementaryInfoItem]] = []
    created_at: Optional[str] = None

class ReviewTaskStatusResponse(BaseModel):
    task_id: int
    module: str
    status: str
    origin_content: Optional[str] = None
    document_name: Optional[str] = None
    processing_time_sec: Optional[float] = None
    error_message: Optional[str] = None
    snapshots_count: int = 0
    result: Optional[ReviewSnapshotItem] = None
    snapshots: List[ReviewSnapshotItem] = []

class ReviewTaskListResponse(BaseModel):
    tasks: List[ReviewTaskStatusResponse]
    total: int = 0
    page: int = 1
    page_size: int = 20
    total_pages: int = 1

class SaveSnapshotRequest(BaseModel):
    module: Optional[str] = None
    processing_time_sec: Optional[float] = None
    blocks: List[DocBlockItem] = []
    conflicts: List[ConflictItem] = []
    supplementaryInfo: Optional[List[SupplementaryInfoItem]] = []
