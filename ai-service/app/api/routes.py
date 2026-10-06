from fastapi import APIRouter, Depends, HTTPException

from app.api.auth import require_service_token
from app.gemini.types import GenerationStatus
from app.schemas.ai_analysis import AiAnalysisRequest, AiAnalysisResponse
from app.embeddings.provider import create_embedding_provider
from app.embeddings.types import EmbeddingRequest, EmbeddingResult
from app.services.analysis import run_analysis

router = APIRouter()


@router.post("/internal/ai/embed", response_model=EmbeddingResult, dependencies=[Depends(require_service_token)])
async def embed(request: EmbeddingRequest) -> EmbeddingResult:
    """Protected embedding utility. It has no database or retrieval access."""
    return await create_embedding_provider().embed(request)

# Explicit failure mapping: provider problems are never converted into fake success.
FAILURE_RESPONSE: dict[GenerationStatus, tuple[int, str]] = {
    GenerationStatus.UNAVAILABLE: (503, "AI_GENERATION_UNAVAILABLE"),
    GenerationStatus.INVALID_OUTPUT: (502, "AI_INVALID_OUTPUT"),
    GenerationStatus.ERROR: (500, "AI_GENERATION_ERROR"),
}


@router.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@router.post(
    "/internal/ai/analyze",
    response_model=AiAnalysisResponse,
    dependencies=[Depends(require_service_token)],
)
async def analyze(request: AiAnalysisRequest) -> AiAnalysisResponse:
    """Explain supplied Node results; deterministic calculations remain in Node."""
    return await run_analysis_request(request)


async def run_analysis_request(request: AiAnalysisRequest) -> AiAnalysisResponse:
    outcome = await run_analysis(request)
    if outcome.status is GenerationStatus.READY and outcome.response is not None:
        return outcome.response
    if outcome.status in (GenerationStatus.NOT_CONFIGURED, GenerationStatus.NOT_IMPLEMENTED):
        # No usable Gemini configuration: keep the explicit contract placeholder.
        return create_placeholder_response(request)
    status_code, code = FAILURE_RESPONSE.get(outcome.status, (500, "AI_GENERATION_ERROR"))
    raise HTTPException(
        status_code=status_code,
        detail={"code": code, "message": "The AI explanation could not be generated."},
    )


def create_placeholder_response(request: AiAnalysisRequest) -> AiAnalysisResponse:
    return AiAnalysisResponse(
        requestId=request.requestId,
        status="READY",
        summary=None,
        keyChanges=[],
        tradeoffs=[],
        # Risk flags are deterministic Node output and remain authoritative
        # even when explanation generation is not configured.
        riskFlags=list(request.riskFlags),
        evidenceRefs=[],
        assumptions=[],
        limitations=["AI explanation is unavailable because Gemini is not configured."],
        model=None,
        promptVersion=None,
        calculationVersion=request.calculationVersion,
    )
