from app.schemas.common import ComponentResult, ComponentStatus
from app.schemas.ai_analysis import StrictModel
from app.schemas.context import AIAnalysisContext


RAGStatus = ComponentStatus


class RAGRequest(StrictModel):
    query: str
    context: AIAnalysisContext


class RAGResult(ComponentResult):
    status: RAGStatus
    evidence_refs: list[str] | None
