"""Pipeline context reuses the authoritative Hour-10 API request model."""

from app.schemas.ai_analysis import AiAnalysisRequest

AIAnalysisContext = AiAnalysisRequest

__all__ = ["AIAnalysisContext"]
