from fastapi import APIRouter, Depends

from app.api.auth import require_service_token
from app.schemas.ai_analysis import AiAnalysisRequest, AiAnalysisResponse

router = APIRouter()


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post(
    "/internal/ai/analyze",
    response_model=AiAnalysisResponse,
    dependencies=[Depends(require_service_token)],
)
def analyze(request: AiAnalysisRequest) -> AiAnalysisResponse:
    """Contract placeholder; deterministic calculations remain in the Node service."""
    return create_placeholder_response(request)


def create_placeholder_response(request: AiAnalysisRequest) -> AiAnalysisResponse:
    return AiAnalysisResponse(
        requestId=request.requestId,
        status="READY",
        summary=None,
        keyChanges=[],
        tradeoffs=[],
        riskFlags=[],
        evidenceRefs=[],
        assumptions=[],
        limitations=["AI explanation service is not implemented yet."],
        model=None,
        promptVersion=None,
        calculationVersion=request.calculationVersion,
    )
