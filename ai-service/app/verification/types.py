from app.schemas.ai_analysis import AiAnalysisResponse, StrictModel
from app.schemas.common import ComponentResult, ComponentStatus
from app.schemas.context import AIAnalysisContext


VerificationStatus = ComponentStatus


class VerificationRequest(StrictModel):
    response: AiAnalysisResponse
    authoritative_context: AIAnalysisContext


class VerificationResult(ComponentResult):
    status: VerificationStatus
    verified: bool | None
