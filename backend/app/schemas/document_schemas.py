from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List

class DocumentMetadataBase(BaseModel):
    filename: str
    module: str
    doc_type: str = "prd"
    version: Optional[str] = "v1.0"

class DocumentMetadataCreate(DocumentMetadataBase):
    content_hash: Optional[str] = None
    file_path: Optional[str] = None

class DocumentMetadata(DocumentMetadataBase):
    id: int
    is_latest: bool
    upload_time: datetime

    class Config:
        from_attributes = True

class UploadResponse(BaseModel):
    message: str
    document_id: int
    chunks_processed: int

class DocumentListResponse(BaseModel):
    documents: List[DocumentMetadata]
    total: int = 0
    page: int = 1
    page_size: int = 6
    total_pages: int = 1
