import unittest
from decimal import Decimal

from pydantic import ValidationError

from app.engine.financial_metrics import FinancialTwinMetrics
from app.engine.risk_flags import (
    RiskSeverity,
    RiskType,
    detect_risk_flags,
)
from app.models.financial_twin import FinancialTwinState


def metrics(
    *,
    surplus=Decimal("10000"),
    goal_gap=Decimal("10000"),
    dti=Decimal("0"),
    coverage=Decimal("2"),
) -> FinancialTwinMetrics:
    return FinancialTwinMetrics(
        monthly_surplus=surplus,
        savings_rate=None,
        debt_to_income=dti,
        emergency_coverage_months=coverage,
        goal_funding_gap=goal_gap,
    )


def flag_types(result) -> set[RiskType]:
    return {flag.type for flag in result.flags}


class RiskFlagTests(unittest.TestCase):
    def test_no_changes_produce_no_flags(self) -> None:
        baseline = metrics()
        result = detect_risk_flags(
            baseline,
            metrics(),
            baseline_liquid_savings=40000,
            scenario_liquid_savings=40000,
            baseline_goal_feasible=True,
            scenario_goal_feasible=True,
        )
        self.assertEqual(result.flags, [])
        self.assertEqual(result.calculations, [])

    def test_negative_surplus_produces_high_flag(self) -> None:
        result = detect_risk_flags(metrics(), metrics(surplus=-1))
        flag = result.flags[0]
        self.assertEqual(flag.type, RiskType.NEGATIVE_SURPLUS)
        self.assertEqual(flag.severity, RiskSeverity.HIGH)
        self.assertEqual(flag.trigger, "scenario_monthly_surplus < 0")
        self.assertEqual(
            set(flag.model_dump(mode="json")),
            {"type", "severity", "trigger", "evidence"},
        )
        self.assertRegex(flag.evidence[0], r"^CALC-[0-9A-F]{12}$")

    def test_zero_surplus_does_not_trigger_negative_surplus(self) -> None:
        self.assertNotIn(
            RiskType.NEGATIVE_SURPLUS,
            flag_types(detect_risk_flags(metrics(), metrics(surplus=0))),
        )

    def test_positive_surplus_does_not_trigger_negative_surplus(self) -> None:
        self.assertNotIn(
            RiskType.NEGATIVE_SURPLUS,
            flag_types(detect_risk_flags(metrics(), metrics(surplus=1))),
        )

    def test_increased_goal_gap_produces_shortfall(self) -> None:
        result = detect_risk_flags(metrics(), metrics(goal_gap=10999))
        flag = next(flag for flag in result.flags if flag.type is RiskType.GOAL_SHORTFALL)
        self.assertEqual(flag.severity, RiskSeverity.LOW)

    def test_goal_becoming_infeasible_is_high_severity(self) -> None:
        result = detect_risk_flags(
            metrics(),
            metrics(goal_gap=20000),
            baseline_goal_feasible=True,
            scenario_goal_feasible=False,
        )
        flag = next(flag for flag in result.flags if flag.type is RiskType.GOAL_SHORTFALL)
        self.assertEqual(flag.severity, RiskSeverity.HIGH)
        self.assertEqual(len(flag.evidence), 2)

    def test_goal_gap_unchanged_does_not_flag_even_if_feasibility_unspecified(self) -> None:
        self.assertNotIn(
            RiskType.GOAL_SHORTFALL,
            flag_types(detect_risk_flags(metrics(), metrics())),
        )

    def test_goal_increased_but_still_feasible_is_not_high(self) -> None:
        result = detect_risk_flags(
            metrics(goal_gap=10000),
            metrics(goal_gap=15000),
            baseline_goal_feasible=True,
            scenario_goal_feasible=True,
        )
        flag = next(flag for flag in result.flags if flag.type is RiskType.GOAL_SHORTFALL)
        self.assertEqual(flag.severity, RiskSeverity.MEDIUM)

    def test_increased_dti_and_zero_to_positive_transition(self) -> None:
        result = detect_risk_flags(metrics(dti=0), metrics(dti=Decimal("0.01")))
        flag = next(
            flag for flag in result.flags if flag.type is RiskType.HIGHER_DEBT_BURDEN
        )
        self.assertEqual(flag.severity, RiskSeverity.HIGH)

    def test_existing_dti_increase_severity_reflects_magnitude(self) -> None:
        result = detect_risk_flags(
            metrics(dti=Decimal("0.1")), metrics(dti=Decimal("0.2"))
        )
        flag = next(
            flag for flag in result.flags if flag.type is RiskType.HIGHER_DEBT_BURDEN
        )
        self.assertEqual(flag.severity, RiskSeverity.HIGH)
        small_increase = detect_risk_flags(
            metrics(dti=Decimal("0.1")), metrics(dti=Decimal("0.105"))
        )
        small_flag = next(
            flag
            for flag in small_increase.flags
            if flag.type is RiskType.HIGHER_DEBT_BURDEN
        )
        self.assertEqual(small_flag.severity, RiskSeverity.LOW)

    def test_unavailable_baseline_or_scenario_dti_does_not_flag(self) -> None:
        self.assertNotIn(
            RiskType.HIGHER_DEBT_BURDEN,
            flag_types(detect_risk_flags(metrics(dti=None), metrics(dti=0.2))),
        )
        self.assertNotIn(
            RiskType.HIGHER_DEBT_BURDEN,
            flag_types(detect_risk_flags(metrics(dti=0.1), metrics(dti=None))),
        )

    def test_reduced_liquid_savings_and_unchanged_or_increased_inputs(self) -> None:
        result = detect_risk_flags(
            metrics(), metrics(), baseline_liquid_savings=100, scenario_liquid_savings=49
        )
        liquidity_flag = next(
            flag for flag in result.flags if flag.type is RiskType.LIQUIDITY_REDUCTION
        )
        self.assertEqual(liquidity_flag.severity, RiskSeverity.HIGH)
        for scenario_savings in (100, 101):
            with self.subTest(scenario_savings=scenario_savings):
                result = detect_risk_flags(
                    metrics(),
                    metrics(),
                    baseline_liquid_savings=100,
                    scenario_liquid_savings=scenario_savings,
                )
                self.assertNotIn(RiskType.LIQUIDITY_REDUCTION, flag_types(result))

    def test_liquidity_severity_uses_explicit_percentage_bands(self) -> None:
        result = detect_risk_flags(
            metrics(), metrics(), baseline_liquid_savings=100, scenario_liquid_savings=95
        )
        flag = next(flag for flag in result.flags if flag.type is RiskType.LIQUIDITY_REDUCTION)
        self.assertEqual(flag.severity, RiskSeverity.LOW)

    def test_reduced_emergency_coverage_flags_only_when_both_values_exist(self) -> None:
        result = detect_risk_flags(
            metrics(coverage=2), metrics(coverage=Decimal("1.5"))
        )
        self.assertIn(RiskType.EMERGENCY_COVERAGE_REDUCTION, flag_types(result))
        unavailable = detect_risk_flags(
            metrics(coverage=None), metrics(coverage=1),
        )
        self.assertNotIn(RiskType.EMERGENCY_COVERAGE_REDUCTION, flag_types(unavailable))
        also_unavailable = detect_risk_flags(
            metrics(coverage=2), metrics(coverage=None),
        )
        self.assertNotIn(
            RiskType.EMERGENCY_COVERAGE_REDUCTION, flag_types(also_unavailable)
        )

    def test_zero_income_and_zero_expense_metrics_do_not_create_false_positives(self) -> None:
        zero_income = metrics(dti=None)
        zero_expenses = metrics(coverage=None)
        result = detect_risk_flags(zero_income, zero_expenses)
        self.assertEqual(result.flags, [])

    def test_multiple_flags_coexist_in_defined_order(self) -> None:
        result = detect_risk_flags(
            metrics(surplus=10000, goal_gap=10000, dti=0, coverage=2),
            metrics(surplus=-1, goal_gap=20000, dti=Decimal("0.1"), coverage=1),
            baseline_liquid_savings=50000,
            scenario_liquid_savings=10000,
            baseline_goal_feasible=True,
            scenario_goal_feasible=False,
        )
        self.assertEqual(
            [flag.type for flag in result.flags],
            [
                RiskType.LIQUIDITY_REDUCTION,
                RiskType.GOAL_SHORTFALL,
                RiskType.NEGATIVE_SURPLUS,
                RiskType.HIGHER_DEBT_BURDEN,
                RiskType.EMERGENCY_COVERAGE_REDUCTION,
            ],
        )

    def test_evidence_ids_are_deterministic_and_resolve_to_comparisons(self) -> None:
        first = detect_risk_flags(
            metrics(surplus=10000), metrics(surplus=-1),
            baseline_liquid_savings=100, scenario_liquid_savings=90,
        )
        second = detect_risk_flags(
            metrics(surplus=10000), metrics(surplus=-1),
            baseline_liquid_savings=100, scenario_liquid_savings=90,
        )
        self.assertEqual(first, second)
        calculations = {item.evidence_id: item for item in first.calculations}
        for flag in first.flags:
            self.assertTrue(flag.evidence)
            for evidence_id in flag.evidence:
                self.assertIn(evidence_id, calculations)
                self.assertTrue(calculations[evidence_id].result)

    def test_negative_raw_inputs_are_rejected_by_existing_validation(self) -> None:
        with self.assertRaises(ValidationError):
            FinancialTwinState(
                monthlyIncome=1000,
                monthlyExpenses=-1,
                liquidSavings=10,
            )


if __name__ == "__main__":
    unittest.main()
