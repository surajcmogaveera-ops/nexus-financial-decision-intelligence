"""Internal Gemini structured-output schema for Hour 12 explanation generation.

This model is an AI-generation representation only. It never replaces the
Node-owned ``AiAnalysisRequest``/``AiAnalysisResponse`` contract, never carries
authoritative deterministic risk flags, and is never exposed to the Node
service directly; an adapter maps it onto the existing Node-facing response.

All fields are strictly validated: unknown fields, unknown confidence values,
and pathological list/string lengths are rejected.
"""

from typing import Annotated, Literal

from pydantic import Field, StringConstraints

from app.schemas.ai_analysis import StrictModel

SummaryText = Annotated[str, StringConstraints(min_length=1, max_length=4000)]
ExplanationItem = Annotated[str, StringConstraints(min_length=1, max_length=2000)]
EvidenceRefText = Annotated[str, StringConstraints(min_length=1, max_length=500)]
DisclaimerText = Annotated[str, StringConstraints(min_length=1, max_length=2000)]

MAX_EXPLANATION_ITEMS = 20
MAX_EVIDENCE_REFS = 50


class GeminiStructuredAnalysis(StrictModel):
    """Strict JSON shape Gemini must return for an analysis explanation."""

    summary: SummaryText = Field(description="Concise explanation of what the scenario means.")
    whatChanged: list[ExplanationItem] = Field(max_length=MAX_EXPLANATION_ITEMS)
    tradeoffs: list[ExplanationItem] = Field(max_length=MAX_EXPLANATION_ITEMS)
    risks: list[ExplanationItem] = Field(
        max_length=MAX_EXPLANATION_ITEMS,
        description="Explanatory prose about supplied deterministic risk flags; never new risk categories.",
    )
    evidenceRefs: list[EvidenceRefText] = Field(
        max_length=MAX_EVIDENCE_REFS,
        description="Only evidence IDs supplied by Node; validated against the supplied evidence set.",
    )
    assumptions: list[ExplanationItem] = Field(max_length=MAX_EXPLANATION_ITEMS)
    limitations: list[ExplanationItem] = Field(max_length=MAX_EXPLANATION_ITEMS)
    confidence: Literal["low", "medium", "high"] = Field(
        description="Confidence in the quality of the explanation, not in the financial outcome.",
    )
    disclaimer: DisclaimerText
