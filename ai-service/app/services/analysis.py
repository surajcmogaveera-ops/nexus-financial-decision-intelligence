"""Hour-12 internal analysis pipeline.

Flow: validate context → PromptBuilder → GeminiClient → Gemini structured
JSON → strict Pydantic validation → evidence/assumption/risk validation →
adapter → existing ``AiAnalysisResponse`` contract.

No financial calculation happens in this pipeline. Every deterministic value,
risk flag, evidence ID, and the calculation version come from the supplied
Node request and are passed through untouched; generated prose stays in a
separate validated object so it cannot overwrite authoritative data.
"""

from pydantic import ValidationError

from app.gemini import GenerationRequest, GenerationStatus, create_gemini_client
from app.gemini.client import GeminiClient
from app.prompts import PromptBuilder
from app.schemas.ai_analysis import AiAnalysisRequest, AiAnalysisResponse, RiskEvidence
from app.schemas.gemini_analysis import GeminiStructuredAnalysis
from app.schemas.common import ComponentStatus

PROMPT_VERSION = "hour12-analysis-v1"


class AnalysisOutcome:
    """Internal pipeline result; carries the contract response only on READY."""

    def __init__(
        self,
        status: ComponentStatus,
        response: AiAnalysisResponse | None = None,
        message: str | None = None,
    ) -> None:
        self.status = status
        self.response = response
        self.message = message


async def run_analysis(
    request: AiAnalysisRequest,
    client: GeminiClient | None = None,
) -> AnalysisOutcome:
    """Run the explanation pipeline for an already-validated Node request."""
    builder = PromptBuilder()
    prompt_request = builder.build_analysis_prompt(request)
    try:
        generation_request = GenerationRequest(prompt=builder.build_generation_prompt(prompt_request))
    except ValidationError:
        return AnalysisOutcome(
            status=GenerationStatus.ERROR,
            message="The analysis prompt exceeds the allowed size.",
        )

    gemini = client if client is not None else create_gemini_client()
    result = await gemini.generate(generation_request)

    if result.status is not GenerationStatus.READY:
        return AnalysisOutcome(status=result.status, message=result.message)
    if not result.text:
        return AnalysisOutcome(
            status=GenerationStatus.INVALID_OUTPUT,
            message="Gemini returned no structured content.",
        )
    try:
        structured = GeminiStructuredAnalysis.model_validate_json(result.text)
    except ValidationError:
        return AnalysisOutcome(
            status=GenerationStatus.INVALID_OUTPUT,
            message="Gemini output failed structured validation.",
        )

    response = adapt_structured_analysis(structured, request, result.model)
    return AnalysisOutcome(
        status=GenerationStatus.READY,
        response=response,
        message="Structured analysis generated.",
    )


def adapt_structured_analysis(
    structured: GeminiStructuredAnalysis,
    request: AiAnalysisRequest,
    model: str | None,
) -> AiAnalysisResponse:
    """Map validated Gemini prose onto the existing Node-facing contract.

    Authoritative deterministic fields (``requestId``, ``riskFlags``,
    ``calculationVersion``) are always taken from the supplied Node request,
    never from generated output. ``risks``, ``confidence``, and ``disclaimer``
    remain internal explanation metadata; the fixed Node contract surfaces
    ``riskFlags`` from Node only.
    """
    return AiAnalysisResponse(
        requestId=request.requestId,
        status="READY",
        summary=structured.summary,
        keyChanges=list(structured.whatChanged),
        tradeoffs=list(structured.tradeoffs),
        riskFlags=list(request.riskFlags),
        evidenceRefs=filter_evidence_refs(structured.evidenceRefs, request),
        assumptions=filter_assumptions(structured.assumptions, request),
        limitations=list(structured.limitations),
        model=model,
        promptVersion=PROMPT_VERSION,
        calculationVersion=request.calculationVersion,
    )


def collect_supplied_evidence_ids(request: AiAnalysisRequest) -> set[str]:
    """Gather every evidence ID supplied by Node across the request."""
    supplied: set[str] = set()
    sources: list[list[RiskEvidence]] = [
        request.evidence,
        request.baseline.evidence,
        request.scenario.evidence,
    ]
    for items in sources:
        for item in items:
            supplied.add(item.evidenceId)
    return supplied


def filter_evidence_refs(candidates: list[str], request: AiAnalysisRequest) -> list[str]:
    """Keep only evidence IDs that Node actually supplied; drop invented ones."""
    supplied = collect_supplied_evidence_ids(request)
    kept: list[str] = []
    for ref in candidates:
        if ref in supplied and ref not in kept:
            kept.append(ref)
    return kept


def filter_assumptions(candidates: list[str], request: AiAnalysisRequest) -> list[str]:
    """Keep only assumptions supplied by Node; drop invented ones."""
    supplied = set(request.assumptions)
    kept: list[str] = []
    for item in candidates:
        if item in supplied and item not in kept:
            kept.append(item)
    return kept
