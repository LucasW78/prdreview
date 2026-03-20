import uuid
import time
from datetime import datetime
from typing import List, Dict, Any

from langchain.text_splitter import MarkdownHeaderTextSplitter
from langchain_community.embeddings import DashScopeEmbeddings
from langchain_community.vectorstores import Qdrant
from qdrant_client import QdrantClient
from qdrant_client.http import models

from app.core.config import settings

# Initialize Qdrant Client
qdrant_client = QdrantClient(url=settings.QDRANT_URL)

# Initialize Qwen Embeddings (DashScope)
# Note: text-embedding-v1 dim=1536
embeddings = DashScopeEmbeddings(
    model="text-embedding-v1",  
    dashscope_api_key=settings.DASHSCOPE_API_KEY
)

COLLECTION_NAME = "prd_knowledge_base"
MAX_RETRIES = 3
RETRY_DELAY_SEC = 1.0

def _retry_embed_documents(texts: List[str]) -> List[List[float]]:
    last_error = None
    for i in range(MAX_RETRIES):
        try:
            return embeddings.embed_documents(texts)
        except Exception as e:
            last_error = e
            print(f"embed_documents failed (attempt {i+1}/{MAX_RETRIES}): {e}")
            if i < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY_SEC * (i + 1))
    raise last_error

def _retry_embed_query(query: str) -> List[float]:
    last_error = None
    for i in range(MAX_RETRIES):
        try:
            return embeddings.embed_query(query)
        except Exception as e:
            last_error = e
            print(f"embed_query failed (attempt {i+1}/{MAX_RETRIES}): {e}")
            if i < MAX_RETRIES - 1:
                time.sleep(RETRY_DELAY_SEC * (i + 1))
    raise last_error

def ensure_collection_exists():
    """Ensure the Qdrant collection exists with correct configuration."""
    try:
        qdrant_client.get_collection(COLLECTION_NAME)
    except Exception:
        # Collection might not exist, try creating it
        try:
            qdrant_client.create_collection(
                collection_name=COLLECTION_NAME,
                vectors_config=models.VectorParams(
                    size=1536,  # Qwen text-embedding-v1 dimension
                    distance=models.Distance.COSINE
                )
            )
        except Exception as e:
            # Handle race condition or if it was created in parallel
            if "already exists" not in str(e):
                print(f"Warning: Failed to create collection: {e}")

def process_document(content: str, module: str, filename: str) -> int:
    """
    Process document content: split, embed, and upsert to Qdrant.
    Returns the number of chunks processed.
    """
    ensure_collection_exists()
    
    # 1. Split by Header
    headers_to_split_on = [
        ("#", "Header 1"),
        ("##", "Header 2"),
        ("###", "Header 3"),
    ]
    markdown_splitter = MarkdownHeaderTextSplitter(headers_to_split_on=headers_to_split_on)
    docs = markdown_splitter.split_text(content)
    
    points = []
    upload_timestamp = int(datetime.utcnow().timestamp())
    
    # 2. Prepare Chunks & Embeddings
    # Batch embedding is more efficient but let's do simple loop for MVP clarity or batch if possible
    # DashScopeEmbeddings supports embed_documents
    
    texts_to_embed = []
    payloads = []
    ids = []
    
    for doc in docs:
        chunk_id = str(uuid.uuid4())
        ids.append(chunk_id)
        
        # Combine header path for context
        header_path = " > ".join([v for k, v in doc.metadata.items() if k.startswith("Header")])
        if not header_path:
            header_path = "Root"
            
        full_text = f"[{module}] {header_path}\n{doc.page_content}"
        texts_to_embed.append(full_text)
        
        payload = {
            "module": module,
            "filename": filename,
            "header_path": header_path,
            "content": doc.page_content,
            "full_text": full_text,
            "upload_time": upload_timestamp,
            "type": "prd" 
        }
        payloads.append(payload)
        
    if not texts_to_embed:
        return 0
        
    # Generate Embeddings in batch
    vectors = _retry_embed_documents(texts_to_embed)
    
    for i, vector in enumerate(vectors):
        points.append(models.PointStruct(
            id=ids[i],
            vector=vector,
            payload=payloads[i]
        ))
        
    # 3. Upsert to Qdrant
    if points:
        qdrant_client.upsert(
            collection_name=COLLECTION_NAME,
            points=points
        )
        
    return len(points)

def search_similar_documents(query: str, module: str, limit: int = 5) -> List[Dict]:
    """
    Search for similar documents in Qdrant with time weighting.
    """
    ensure_collection_exists()
    
    query_vector = _retry_embed_query(query)
    
    # Filter by module
    search_filter = models.Filter(
        must=[
            models.FieldCondition(
                key="module",
                match=models.MatchValue(value=module)
            )
        ]
    )
    
    hits = qdrant_client.search(
        collection_name=COLLECTION_NAME,
        query_vector=query_vector,
        query_filter=search_filter,
        limit=limit
    )
    
    results = []
    current_time = datetime.utcnow().timestamp()
    
    for hit in hits:
        payload = hit.payload
        upload_time = payload.get("upload_time", 0)
        
        # Calculate Time Weight (Simple Decay)
        # Weight = 1.0 / (1 + months_passed * 0.1)
        # 1 month = 2592000 seconds
        months_passed = (current_time - upload_time) / 2592000
        time_weight = 1.0 / (1.0 + max(0, months_passed) * 0.1)
        
        # Final Score
        final_score = hit.score * time_weight
        
        results.append({
            "id": hit.id,
            "score": final_score,
            "original_score": hit.score,
            "content": payload.get("content"),
            "header_path": payload.get("header_path"),
            "filename": payload.get("filename"),
            "time_weight": time_weight
        })
        
    # Sort by final score
    results.sort(key=lambda x: x["score"], reverse=True)
    return results
