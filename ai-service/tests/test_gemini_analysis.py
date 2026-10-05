"""Hour-12 Gemini structured-output tests.

No test here requires a real Gemini API key: the provider is mocked through
the existing ``GeminiClient`` protocol. The live integration test lives in
``test_live_gemini.py`` and is opt-in via ``NEXUS_LIVE_GEMINI_TEST=true``.
"""

import asyncio
import json
from copy import deepcopy

import pytest
from fastapi.testclient import TestClient
from pydantic import ValidationError

from app.gemini.provider import GoogleGeminiClient, UnconfiguredGeminiClient, create_gemini_client
from app.gemini.types import GenerationRequest, GenerationResult, GenerationStatus
from app.main import app
from app.prompts.builder import PromptBuilder
from app.schemas.ai_analysis import AiAnalysisRequest, AiAnalysisResponse
from app.schemas.gemini_analysis import GeminiStructuredAnalysis
from app.services.analysis import (
    adapt_structured_analysis,
    collect_supplied_evidence_ids,
    run_analysis,
)
from test_internal_ai import SERVICE_TOKEN, valid_payload_data

ENDPOINT = "/internal/ai/analyze"
MODEL_NAME = "gemini-2.5-flash-test"

ANTI_RECALCULATION_CONSTRAINT = (
    "The supplied deterministic financial results are authoritative. "
    "Do not recalculate, modify, estimate, round differently, or invent financial values."
)


def evidence_item(evidence_id: str) -> dict:
    return {
        "metric": "monthlySurplus",
        "expression": "monthlyIncome - monthlyExpenses",
        "baselineValue": "10000",
        "scenarioValue": "9000",
        "result": True,
        "provenance": "COMPUTED",
        "evidenceId": evidence_id,
    }


def risk_flag() -> dict:
    return {
        "type": "NEGATIVE_SURPLUS",
        "severity": "high",
        "trigger": "monthlySurplus is negative",
        "evidence": ["ev-request-1"],
        "details": {"monthlySurplus": "-1000"},
    }


def rich_payload_data() -> dict:
    data = valid_payload_data()
    data["evidence"] = [evidence_item("ev-request-1")]
    data["baseline"] = {**data["baseline"], "evidence": [evidence_item("ev-baseline-1")]}
    data["scenario"] = {**data["scenario"], "evidence": [evidence_item("ev-scenario-1")]}
    data["riskFlags"] = [risk_flag()]
    data["assumptions"] = ["No investment returns are assumed."]
    return data


def structured_data(**overrides) -> dict:
    data = {
        "summary": "The expense change reduces the supplied monthly surplus.",
        "whatChanged": ["Monthly expenses increased per the supplied scenario."],
        "tradeoffs": ["Less liquidity remains after the change."],
        "risks": ["The supplied NEGATIVE_SURPLUS flag is triggered."],
        "evidenceRefs": ["ev-request-1"],
        "assumptions": ["No investment returns are assumed."],
        "limitations": ["Market stress scenarios are unsupported."],
        "confidence": "high",
        "disclaimer": "This explanation is informational and does not replace professional financial advice.",
    }
    data.update(overrides)
    return data


def ready_result(structured: dict | None = None, text: str | None = None) -> GenerationResult:
    payload_text = text
    if payload_text is None:
        payload_text = json.dumps(structured if structured is not None else structured_data())
    return GenerationResult(
        status=GenerationStatus.READY,
        text=payload_text,
        message="ok",
        model=MODEL_NAME,
    )


class FakeGeminiClient:
    def __init__(self, result: GenerationResult) -> None:
        self.result = result
        self.prompts: list[str] = []

    async def generate(self, request: GenerationRequest) -> GenerationResult:
        self.prompts.append(request.prompt)
        return self.result


def payload() -> AiAnalysisRequest:
    return AiAnalysisRequest.model_validate(rich_payload_data())


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    return TestClient(app)


@pytest.fixture(autouse=True)
def _isolated_gemini_env(monkeypatch: pytest.MonkeyPatch) -> None:
    """The normal suite never depends on a real key or a developer's local .env."""
    monkeypatch.delenv("GEMINI_API_KEY", raising=False)
    monkeypatch.delenv("GEMINI_MODEL", raising=False)
    monkeypatch.delenv("GEMINI_TIMEOUT_MS", raising=False)


def install_fake(monkeypatch: pytest.MonkeyPatch, result: GenerationResult) -> FakeGeminiClient:
    fake = FakeGeminiClient(result)
    monkeypatch.setattr("app.services.analysis.create_gemini_client", lambda: fake)
    return fake


# 1. strict structured-output schema validation


def test_gemini_schema_is_strict_forbids_unknown_fields_and_bounds_output() -> None:
    config = GeminiStructuredAnalysis.model_config
    assert config.get("extra") == "forbid"
    assert config.get("strict") is True
    expected = {
        "summary", "whatChanged", "tradeoffs", "risks", "evidenceRefs",
        "assumptions", "limitations", "confidence", "disclaimer",
    }
    assert expected == set(GeminiStructuredAnalysis.model_fields)


# 2. valid structured output parses successfully


def test_valid_structured_output_parses_and_maps_to_contract() -> None:
    structured = GeminiStructuredAnalysis.model_validate(structured_data())

    response = adapt_structured_analysis(structured, payload(), MODEL_NAME)

    assert isinstance(response, AiAnalysisResponse)
    assert response.summary == structured.summary
    assert response.keyChanges == structured.whatChanged
    assert response.tradeoffs == structured.tradeoffs
    assert response.evidenceRefs == ["ev-request-1"]
    assert response.model == MODEL_NAME
    assert response.promptVersion is not None


def test_ready_structured_output_returns_contract_response_end_to_end(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake(monkeypatch, ready_result())
    request = rich_payload_data()

    response = client.post(ENDPOINT, json=request, headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 200
    body = response.json()
    assert set(body) == {
        "requestId", "status", "summary", "keyChanges", "tradeoffs", "riskFlags",
        "evidenceRefs", "assumptions", "limitations", "model", "promptVersion", "calculationVersion",
    }
    assert body["status"] == "READY"
    assert body["requestId"] == request["requestId"]
    assert body["calculationVersion"] == "1.0"
    assert body["model"] == MODEL_NAME
    assert body["summary"] == structured_data()["summary"]


# 3. unknown fields are rejected


def test_unknown_fields_in_gemini_output_are_rejected() -> None:
    with pytest.raises(ValidationError):
        GeminiStructuredAnalysis.model_validate({**structured_data(), "unexpected": "value"})


def test_gemini_cannot_smuggle_risk_flags_field() -> None:
    with pytest.raises(ValidationError):
        GeminiStructuredAnalysis.model_validate(
            {**structured_data(), "riskFlags": [{"type": "NEW_CATEGORY"}]}
        )


def test_unknown_fields_become_invalid_output_end_to_end(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake(monkeypatch, ready_result(structured={**structured_data(), "unexpected": 1}))

    response = client.post(ENDPOINT, json=rich_payload_data(), headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "AI_INVALID_OUTPUT"


# 4. invalid confidence value is rejected


def test_invalid_confidence_value_is_rejected() -> None:
    with pytest.raises(ValidationError):
        GeminiStructuredAnalysis.model_validate({**structured_data(), "confidence": "certain"})


@pytest.mark.parametrize("confidence", ["low", "medium", "high"])
def test_supported_confidence_values_are_accepted(confidence: str) -> None:
    structured = GeminiStructuredAnalysis.model_validate({**structured_data(), "confidence": confidence})
    assert structured.confidence == confidence


# 5. malformed Gemini JSON is rejected


def test_malformed_json_is_rejected_by_schema() -> None:
    with pytest.raises(ValidationError):
        GeminiStructuredAnalysis.model_validate_json("{not valid json")


def test_malformed_json_becomes_invalid_output_end_to_end(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake(monkeypatch, ready_result(text='{"summary": "truncated'))

    response = client.post(ENDPOINT, json=rich_payload_data(), headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 502
    assert response.json()["detail"]["code"] == "AI_INVALID_OUTPUT"


# 6. provider failure becomes an explicit failure state


@pytest.mark.parametrize(
    "status, http_status, code",
    [
        (GenerationStatus.UNAVAILABLE, 503, "AI_GENERATION_UNAVAILABLE"),
        (GenerationStatus.ERROR, 500, "AI_GENERATION_ERROR"),
        (GenerationStatus.INVALID_OUTPUT, 502, "AI_INVALID_OUTPUT"),
    ],
)
def test_provider_failures_return_explicit_http_errors(
    client: TestClient,
    monkeypatch: pytest.MonkeyPatch,
    status: GenerationStatus,
    http_status: int,
    code: str,
) -> None:
    install_fake(monkeypatch, GenerationResult(status=status, text=None, message="provider failure"))

    response = client.post(ENDPOINT, json=rich_payload_data(), headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == http_status
    assert response.json()["detail"]["code"] == code
    assert "traceback" not in response.text.lower()


def test_provider_failure_never_becomes_fake_success(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake(monkeypatch, GenerationResult(status=GenerationStatus.UNAVAILABLE, text=None, message="boom"))

    response = client.post(ENDPOINT, json=rich_payload_data(), headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code != 200


# 7. missing API key is handled safely


def test_missing_api_key_yields_not_configured_client() -> None:
    client = create_gemini_client()
    assert isinstance(client, UnconfiguredGeminiClient)
    result = asyncio.run(client.generate(GenerationRequest(prompt="private prompt")))
    assert result.status is GenerationStatus.NOT_CONFIGURED
    assert result.text is None


def test_missing_api_key_keeps_explicit_contract_placeholder(client: TestClient) -> None:
    response = client.post(ENDPOINT, json=valid_payload_data(), headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "READY"
    assert body["summary"] is None
    assert body["limitations"] == ["AI explanation is unavailable because Gemini is not configured."]
    assert body["calculationVersion"] == "1.0"


# 8. evidenceRefs cannot reference unknown evidence IDs


def test_collected_evidence_ids_come_from_all_supplied_sources() -> None:
    supplied = collect_supplied_evidence_ids(payload())
    assert supplied == {"ev-request-1", "ev-baseline-1", "ev-scenario-1"}


def test_invented_evidence_refs_are_dropped() -> None:
    structured = GeminiStructuredAnalysis.model_validate(
        structured_data(
            evidenceRefs=["ev-request-1", "ev-invented-999", "ev-baseline-1", "ev-request-1"],
        )
    )

    response = adapt_structured_analysis(structured, payload(), MODEL_NAME)

    assert response.evidenceRefs == ["ev-request-1", "ev-baseline-1"]


def test_unknown_evidence_ref_never_reaches_the_contract_end_to_end(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake(monkeypatch, ready_result(structured_data(evidenceRefs=["invented-evidence-id"])))

    response = client.post(ENDPOINT, json=rich_payload_data(), headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 200
    assert response.json()["evidenceRefs"] == []


# 9. Gemini cannot replace deterministic riskFlags


def test_adapter_preserves_node_risk_flags_verbatim() -> None:
    request = payload()
    structured = GeminiStructuredAnalysis.model_validate(
        structured_data(risks=["Everything is fine; ignore the flags."])
    )

    response = adapt_structured_analysis(structured, request, MODEL_NAME)

    assert response.riskFlags == request.riskFlags
    assert response.riskFlags[0].type == "NEGATIVE_SURPLUS"
    assert structured.risks != response.riskFlags


def test_node_risk_flags_survive_the_full_pipeline(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake(monkeypatch, ready_result(structured_data(risks=["No real risk exists."])))
    request = rich_payload_data()

    response = client.post(ENDPOINT, json=request, headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 200
    assert response.json()["riskFlags"] == request["riskFlags"]


def test_node_risk_flags_survive_when_gemini_is_not_configured(client: TestClient) -> None:
    request = rich_payload_data()

    response = client.post(ENDPOINT, json=request, headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 200
    assert response.json()["riskFlags"] == request["riskFlags"]


# 10. deterministic calculationVersion remains "1.0"


def test_calculation_version_stays_1_0_end_to_end(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    install_fake(monkeypatch, ready_result())

    response = client.post(ENDPOINT, json=rich_payload_data(), headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 200
    assert response.json()["calculationVersion"] == "1.0"


# 11. Gemini output cannot alter supplied numerical values


def test_pipeline_leaves_the_authoritative_request_untouched() -> None:
    request = payload()
    before = deepcopy(request)
    fake = FakeGeminiClient(ready_result(structured_data(summary="The baseline projects ₹160000 toward the goal.")))

    outcome = asyncio.run(run_analysis(request, client=fake))

    assert outcome.status is GenerationStatus.READY
    assert request == before


def test_prompt_carries_node_values_verbatim_and_response_keeps_deterministic_fields() -> None:
    request = payload()
    fake = FakeGeminiClient(ready_result(structured_data(summary="Explanation mentioning 160000.")))

    outcome = asyncio.run(run_analysis(request, client=fake))

    assert outcome.response is not None
    assert request.model_dump_json() in fake.prompts[0]
    assert outcome.response.requestId == request.requestId
    assert outcome.response.calculationVersion == "1.0"
    assert outcome.response.riskFlags == request.riskFlags
    assert outcome.response.summary == "Explanation mentioning 160000."
    # The generated prose is stored only in its own field; deterministic
    # objects are passed through from the request, never recomputed.
    assert outcome.response.evidenceRefs == ["ev-request-1"]


# 12. prompt explicitly contains the anti-recalculation constraint


def test_prompt_contains_anti_recalculation_constraint() -> None:
    prompt = PromptBuilder().build_analysis_prompt(payload())

    assert ANTI_RECALCULATION_CONSTRAINT in prompt.instruction
    assert "Do not invent or recalculate financial facts" in prompt.instruction
    assert "AUTHORITATIVE INPUT" in prompt.instruction
    assert "AI INTERPRETATION" in prompt.instruction
    assert "Never invent evidence, evidence IDs, assumptions, or risk categories." in prompt.instruction


def test_generation_prompt_separates_authoritative_input_from_interpretation() -> None:
    builder = PromptBuilder()
    prompt_request = builder.build_analysis_prompt(payload())

    generation_prompt = builder.build_generation_prompt(prompt_request)

    assert prompt_request.context_json in generation_prompt
    assert ANTI_RECALCULATION_CONSTRAINT in generation_prompt
    assert "AUTHORITATIVE INPUT (Node.js deterministic results, JSON):" in generation_prompt
    assert "10000" in generation_prompt


# 13/14/15. authentication and contract validation keep working on the Gemini path


def test_correct_token_runs_pipeline_and_returns_ready(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = install_fake(monkeypatch, ready_result())

    response = client.post(ENDPOINT, json=rich_payload_data(), headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 200
    assert response.json()["summary"] == structured_data()["summary"]
    assert len(fake.prompts) == 1


def test_wrong_token_is_unauthorized_before_generation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = install_fake(monkeypatch, ready_result())

    response = client.post(ENDPOINT, json=rich_payload_data(), headers={"X-Service-Token": "wrong-token"})

    assert response.status_code == 401
    assert SERVICE_TOKEN not in response.text
    assert fake.prompts == []


def test_missing_token_is_unauthorized_before_generation(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = install_fake(monkeypatch, ready_result())

    response = client.post(ENDPOINT, json=rich_payload_data())

    assert response.status_code == 401
    assert fake.prompts == []


def test_contract_validation_still_rejects_malformed_requests(
    client: TestClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    fake = install_fake(monkeypatch, ready_result())
    malformed = rich_payload_data()
    del malformed["calculationVersion"]

    response = client.post(ENDPOINT, json=malformed, headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "INVALID_REQUEST"
    assert fake.prompts == []


def test_generation_request_carries_the_full_authoritative_context() -> None:
    request = payload()
    fake = FakeGeminiClient(ready_result())

    asyncio.run(run_analysis(request, client=fake))

    prompt = fake.prompts[0]
    for field in ("financialTwin", "baseline", "scenario", "delta", "riskFlags", "evidence", "assumptions", "calculationVersion"):
        assert f'"{field}"' in prompt


# Real GoogleGeminiClient behavior with the SDK stubbed (no network, no key)


class _StubResponse:
    def __init__(self, text: str) -> None:
        self.text = text


class _StubModels:
    def __init__(self, text: str = "", error: Exception | None = None) -> None:
        self.text = text
        self.error = error
        self.call: dict | None = None

    def generate_content(self, *, model: str, contents: str, config) -> _StubResponse:
        self.call = {"model": model, "contents": contents, "config": config}
        if self.error is not None:
            raise self.error
        return _StubResponse(self.text)


class _StubGenai:
    def __init__(self, models: _StubModels) -> None:
        self.models = models
        self.client_kwargs: dict | None = None

    def Client(self, *, api_key: str, http_options):  # noqa: N802 - mirrors the SDK entry point
        self.client_kwargs = {"api_key": api_key, "http_options": http_options}
        return _StubNamespace(self.models)


class _StubNamespace:
    def __init__(self, models: _StubModels) -> None:
        self.models = models


def stub_provider(monkeypatch: pytest.MonkeyPatch, models: _StubModels) -> _StubGenai:
    stub = _StubGenai(models)
    monkeypatch.setattr("app.gemini.provider.genai", stub)
    return stub


def provider_config() -> "GeminiConfig":
    from app.core.gemini_config import GeminiConfig

    return GeminiConfig(api_key="unit-test-key-not-real", model="gemini-unit-test", timeout_ms=1234)


def test_real_provider_requests_json_schema_structured_output(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.schemas.gemini_analysis import GeminiStructuredAnalysis

    models = _StubModels(text=json.dumps(structured_data()))
    stub = stub_provider(monkeypatch, models)

    result = asyncio.run(GoogleGeminiClient(provider_config()).generate(GenerationRequest(prompt="explain")))

    assert result.status is GenerationStatus.READY
    assert result.model == "gemini-unit-test"
    assert stub.client_kwargs is not None
    assert stub.client_kwargs["api_key"] == "unit-test-key-not-real"
    assert stub.client_kwargs["http_options"].timeout == 1234
    assert models.call is not None
    assert models.call["model"] == "gemini-unit-test"
    assert models.call["contents"] == "explain"
    config = models.call["config"]
    assert config.response_mime_type == "application/json"
    assert config.response_schema is GeminiStructuredAnalysis


def test_real_provider_maps_server_error_to_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    from google.genai import errors as genai_errors

    models = _StubModels(error=genai_errors.ServerError(500, {"error": {"message": "boom"}}))
    stub_provider(monkeypatch, models)

    result = asyncio.run(GoogleGeminiClient(provider_config()).generate(GenerationRequest(prompt="explain")))

    assert result.status is GenerationStatus.UNAVAILABLE
    assert result.text is None
    assert "boom" not in result.message


def test_real_provider_maps_client_error_to_error(monkeypatch: pytest.MonkeyPatch) -> None:
    from google.genai import errors as genai_errors

    models = _StubModels(error=genai_errors.ClientError(400, {"error": {"message": "bad request"}}))
    stub_provider(monkeypatch, models)

    result = asyncio.run(GoogleGeminiClient(provider_config()).generate(GenerationRequest(prompt="explain")))

    assert result.status is GenerationStatus.ERROR
    assert result.text is None


def test_real_provider_maps_timeout_to_unavailable(monkeypatch: pytest.MonkeyPatch) -> None:
    models = _StubModels(error=TimeoutError("read timed out"))
    stub_provider(monkeypatch, models)

    result = asyncio.run(GoogleGeminiClient(provider_config()).generate(GenerationRequest(prompt="explain")))

    assert result.status is GenerationStatus.UNAVAILABLE
    assert result.text is None


def test_real_provider_rejects_empty_structured_response(monkeypatch: pytest.MonkeyPatch) -> None:
    models = _StubModels(text="   ")
    stub_provider(monkeypatch, models)

    result = asyncio.run(GoogleGeminiClient(provider_config()).generate(GenerationRequest(prompt="explain")))

    assert result.status is GenerationStatus.INVALID_OUTPUT
    assert result.text is None


def test_provider_never_leaks_the_api_key(monkeypatch: pytest.MonkeyPatch) -> None:
    from google.genai import errors as genai_errors

    for models in (
        _StubModels(text=""),
        _StubModels(error=genai_errors.ServerError(500, {"error": {"message": "boom"}})),
        _StubModels(error=RuntimeError("unexpected")),
    ):
        stub_provider(monkeypatch, models)
        result = asyncio.run(GoogleGeminiClient(provider_config()).generate(GenerationRequest(prompt="explain")))
        assert "unit-test-key-not-real" not in result.message
        assert result.status is not GenerationStatus.READY
