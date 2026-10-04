# NEXUS AI service

This FastAPI service is reserved for future document ingestion, retrieval, embeddings, RAG, and Gemini orchestration. At this architecture-reset stage it only exposes `GET /health`; no AI behavior is implemented.

```powershell
python -m pip install -r requirements.txt
python -m uvicorn app.main:app --reload --port 8000
```
