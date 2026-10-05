"""Opt-in live Gemini integration test.

Never runs in the normal suite: it requires an explicit environment variable
and a real API key, so routine test runs stay offline and credential-free.

Enable with:

    NEXUS_LIVE_GEMINI_TEST=true GEMINI_API_KEY=... python -m pytest tests -q
"""

import asyncio
import os

import pytest

from app.gemini.types import GenerationStatus
from app.schemas.ai_analysis import AiAnalysisRequest
from app.services.analysis import run_analysis
from test_internal_ai import valid_payload_data

pytestmark = pytest.mark.skipif(
    os.environ.get("NEXUS_LIVE_GEMINI_TEST", "").lower() != "true",
    reason="Live Gemini test is opt-in via NEXUS_LIVE_GEMINI_TEST=true.",
)


def test_live_gemini_returns_validated_structured_analysis() -> None:
    if not os.environ.get("GEMINI_API_KEY"):
        pytest.skip("GEMINI_API_KEY is not set for the live Gemini test.")

    request = AiAnalysisRequest.model_validate(valid_payload_data())
    before = request.model_dump()

    outcome = asyncio.run(run_analysis(request))

    assert outcome.status is GenerationStatus.READY, outcome.message
    assert outcome.response is not None
    assert outcome.response.requestId == request.requestId
    assert outcome.response.status == "READY"
    assert outcome.response.calculationVersion == "1.0"
    assert outcome.response.riskFlags == request.riskFlags
    assert outcome.response.promptVersion is not None
    assert isinstance(outcome.response.summary, str) and outcome.response.summary
    assert request.model_dump() == before
