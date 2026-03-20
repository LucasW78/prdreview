from datetime import datetime
from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, Text
from sqlalchemy.orm import relationship
from app.db.base import Base

class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)

class DocumentMetadata(Base):
    __tablename__ = "docs_metadata"

    id = Column(Integer, primary_key=True, index=True)
    filename = Column(String, nullable=False)
    module = Column(String, nullable=False, index=True)
    doc_type = Column(String, nullable=False, default="prd")
    version = Column(String)
    is_latest = Column(Boolean, default=True)
    upload_time = Column(DateTime, default=datetime.utcnow)
    content_hash = Column(String, nullable=True)
    file_path = Column(String, nullable=True)

class ReviewTask(Base):
    __tablename__ = "review_tasks"

    id = Column(Integer, primary_key=True, index=True)
    module = Column(String, nullable=False)
    status = Column(String, default="pending") # pending, processing, completed, failed
    origin_content = Column(Text, nullable=False)
    optimized_content = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    
    conflicts = relationship("ConflictCard", back_populates="task")

class ConflictCard(Base):
    __tablename__ = "conflict_cards"

    id = Column(Integer, primary_key=True, index=True)
    task_id = Column(Integer, ForeignKey("review_tasks.id"))
    conflict_type = Column(String, nullable=False) # conflict, sop
    description = Column(Text, nullable=False)
    is_ignored = Column(Boolean, default=False)
    
    task = relationship("ReviewTask", back_populates="conflicts")
