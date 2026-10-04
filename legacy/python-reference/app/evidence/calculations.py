"""Stable evidence records for deterministic financial comparisons."""

from dataclasses import dataclass
from datetime import date
from decimal import Decimal
import hashlib
import json

from app.evidence.provenance import ProvenanceType


def _stable_evidence_id(record: dict[str, object]) -> str:
    encoded = json.dumps(record, sort_keys=True, separators=(",", ":"))
    identifier = hashlib.sha256(encoded.encode("utf-8")).hexdigest()[:12].upper()
    return f"CALC-{identifier}"


def _canonical(value):
    if isinstance(value, Decimal):
        return str(value.normalize()) if value else "0"
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, ProvenanceType):
        return value.value
    return value


@dataclass(frozen=True)
class CalculationEvidence:
    """A recorded metric comparison used by one or more generated flags."""

    metric: str
    expression: str
    baseline_value: Decimal | bool | None
    scenario_value: Decimal | bool | None
    result: bool
    provenance: ProvenanceType = ProvenanceType.COMPUTED

    @property
    def evidence_id(self) -> str:
        return _stable_evidence_id({
            "metric": self.metric,
            "expression": self.expression,
            "baseline": _canonical(self.baseline_value),
            "scenario": _canonical(self.scenario_value),
            "result": self.result,
            "provenance": self.provenance.value,
        })


@dataclass(frozen=True)
class GoalCalculationEvidence:
    """A stable record of a Goal Engine formula and its actual output."""

    calculation: str
    inputs: tuple[tuple[str, Decimal | int | bool | str | date | None], ...]
    output: Decimal | int | bool | str | None
    provenance: ProvenanceType = ProvenanceType.COMPUTED

    @property
    def evidence_id(self) -> str:
        return _stable_evidence_id(
            {
                "calculation": self.calculation,
                "inputs": {
                    name: _canonical(value) for name, value in self.inputs
                },
                "output": _canonical(self.output),
                "provenance": self.provenance.value,
            }
        )
