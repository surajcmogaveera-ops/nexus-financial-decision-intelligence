from copy import deepcopy

import pytest
from fastapi.testclient import TestClient

from app.main import app

SERVICE_TOKEN = "controlled-test-service-token-with-more-than-32-bytes"
ENDPOINT = "/internal/ai/analyze"


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> TestClient:
    monkeypatch.setenv("SERVICE_TOKEN", SERVICE_TOKEN)
    return TestClient(app)


def valid_payload_data() -> dict:
    raw = {
        "currency": "INR",
        "monthlyIncome": "30000",
        "monthlyExpenses": "20000",
        "monthlyDebtPayments": "0",
        "liquidSavings": "40000",
        "investments": "0",
        "monthlyInvestmentContribution": "0",
        "essentialMonthlyExpenses": "20000",
        "goals": [],
    }
    derived = {
        "monthlySurplus": "10000",
        "availableMonthlyCashFlow": "10000",
        "savingsRate": 1 / 3,
        "debtToIncome": 0,
        "emergencyCoverageMonths": 2,
        "currentFundingGap": "0",
        "requiredMonthlyContribution": None,
        "goals": [],
    }
    provenance = {
        "raw": {"monthlyIncome": "USER", "monthlyExpenses": "USER"},
        "derived": {
            "monthlySurplus": "COMPUTED",
            "availableMonthlyCashFlow": "COMPUTED",
            "savingsRate": "COMPUTED",
            "debtToIncome": "COMPUTED",
            "emergencyCoverageMonths": "COMPUTED",
            "currentFundingGap": "COMPUTED",
            "requiredMonthlyContribution": "COMPUTED",
            "goals": "COMPUTED",
        },
    }
    twin = {"raw": raw, "derived": derived, "provenance": provenance}
    return {
        "requestId": "e88c4000-025a-4b2f-8b80-2e287bc22de0",
        "question": "Explain the deterministic scenario changes.",
        "financialTwin": twin,
        "baseline": {**twin, "evidence": []},
        "scenario": {
            "type": "EXPENSE_CHANGE",
            "status": "COMPLETED",
            **twin,
            "evidence": [],
        },
        "delta": {
            key: {"delta": "0", "percentageDelta": 0}
            for key in (
                "monthlySurplus", "availableMonthlyCashFlow", "savingsRate", "debtToIncome",
                "emergencyCoverageMonths", "currentFundingGap", "projectedAmount",
                "projectedGoalShortfall", "liquidityImpact",
            )
        } | {"additionalScenarioShortfall": None},
        "riskFlags": [],
        "assumptions": [],
        "evidence": [],
        "calculationVersion": "1.0",
    }


@pytest.fixture
def valid_payload() -> dict:
    return valid_payload_data()


def test_correct_service_token_returns_contract_placeholder(client: TestClient, valid_payload: dict) -> None:
    response = client.post(ENDPOINT, json=valid_payload, headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 200
    body = response.json()
    assert body == {
        "requestId": valid_payload["requestId"],
        "status": "READY",
        "summary": None,
        "keyChanges": [],
        "tradeoffs": [],
        "riskFlags": [],
        "evidenceRefs": [],
        "assumptions": [],
        "limitations": ["AI explanation is unavailable because Gemini is not configured."],
        "model": None,
        "promptVersion": None,
        "calculationVersion": "1.0",
    }


@pytest.mark.parametrize(
    "headers, query",
    [({}, ""), ({"X-Service-Token": "wrong-token"}, ""), ({"X-Service-Token": ""}, ""), ({}, "?token=" + SERVICE_TOKEN)],
)
def test_missing_empty_wrong_and_query_tokens_are_unauthorized(
    client: TestClient,
    valid_payload: dict,
    headers: dict[str, str],
    query: str,
) -> None:
    response = client.post(ENDPOINT + query, json=valid_payload, headers=headers)
    assert response.status_code == 401
    assert SERVICE_TOKEN not in response.text


def test_authorization_header_is_not_an_alternative(client: TestClient, valid_payload: dict) -> None:
    response = client.post(
        ENDPOINT,
        json=valid_payload,
        headers={"Authorization": f"Bearer {SERVICE_TOKEN}"},
    )
    assert response.status_code == 401
    assert SERVICE_TOKEN not in response.text


def test_correct_token_with_malformed_contract_returns_clean_422(client: TestClient, valid_payload: dict) -> None:
    malformed = deepcopy(valid_payload)
    del malformed["calculationVersion"]
    response = client.post(ENDPOINT, json=malformed, headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 422
    assert response.json() == {
        "error": {
            "code": "INVALID_REQUEST",
            "message": "The internal AI request does not match the contract.",
        }
    }
    assert SERVICE_TOKEN not in response.text
    assert "traceback" not in response.text.lower()


@pytest.mark.parametrize("invalid", ["AI", "GENERATED", "SYSTEM", "UNKNOWN", "MODEL", "AI_GENERATED", "AI_INTERPRETATION"])
def test_invalid_provenance_is_rejected_at_internal_boundary(
    client: TestClient,
    valid_payload: dict,
    invalid: str,
) -> None:
    malformed = deepcopy(valid_payload)
    malformed["financialTwin"]["provenance"]["raw"]["monthlyIncome"] = invalid
    response = client.post(ENDPOINT, json=malformed, headers={"X-Service-Token": SERVICE_TOKEN})
    assert response.status_code == 422


def test_unexpected_service_error_returns_clean_500(
    client: TestClient,
    valid_payload: dict,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    import app.api.routes as routes

    def fail(_request):
        raise RuntimeError(f"private failure with token {SERVICE_TOKEN}")

    monkeypatch.setattr(routes, "create_placeholder_response", fail)
    test_client = TestClient(app, raise_server_exceptions=False)
    response = test_client.post(ENDPOINT, json=valid_payload, headers={"X-Service-Token": SERVICE_TOKEN})

    assert response.status_code == 500
    assert response.json()["error"]["code"] == "INTERNAL_ERROR"
    assert SERVICE_TOKEN not in response.text
    assert "traceback" not in response.text.lower()
