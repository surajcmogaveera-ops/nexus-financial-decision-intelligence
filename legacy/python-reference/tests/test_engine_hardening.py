import unittest
from datetime import date
from decimal import Decimal

from app.engine.financial_metrics import (
    FinancialTwinMetrics,
    calculate_financial_metrics,
)
from app.engine.goal_engine import calculate_goal
from app.engine.risk_flags import RiskDetectionResult, RiskType, detect_risk_flags
from app.models.financial_twin import FinancialTwinState
from app.models.goal import Goal


class EngineContractHardeningTests(unittest.TestCase):
    def test_canonical_financial_example_uses_financial_engine(self) -> None:
        state = FinancialTwinState(
            monthlyIncome=30000,
            monthlyExpenses=20000,
            monthlyDebtPayments=0,
            liquidSavings=40000,
        )

        result = calculate_financial_metrics(state)

        self.assertEqual(result.monthly_surplus, Decimal("10000"))
        self.assertEqual(result.savings_rate, Decimal("10000") / Decimal("30000"))
        self.assertAlmostEqual(float(result.savings_rate * 100), 33.3333, places=3)

    def test_zero_income_and_zero_expenses_keep_defined_financial_behavior(self) -> None:
        zero_income = calculate_financial_metrics(
            FinancialTwinState(
                monthlyIncome=0,
                monthlyExpenses=20000,
                monthlyDebtPayments=0,
                liquidSavings=0,
            )
        )
        self.assertEqual(zero_income.monthly_surplus, Decimal("-20000"))
        self.assertIsNone(zero_income.savings_rate)
        self.assertIsNone(zero_income.debt_to_income)

        zero_expenses = calculate_financial_metrics(
            FinancialTwinState(
                monthlyIncome=30000,
                monthlyExpenses=0,
                monthlyDebtPayments=0,
                liquidSavings=0,
            )
        )
        self.assertEqual(zero_expenses.monthly_surplus, Decimal("30000"))
        self.assertEqual(zero_expenses.savings_rate, Decimal("1"))

    def test_debt_payment_is_separate_and_subtracted_from_surplus(self) -> None:
        state = FinancialTwinState(
            monthlyIncome=30000,
            monthlyExpenses=20000,
            monthlyDebtPayments=5000,
            liquidSavings=40000,
        )

        result = calculate_financial_metrics(state)

        self.assertEqual(state.monthly_expenses, Decimal("20000"))
        self.assertEqual(result.monthly_surplus, Decimal("5000"))
        self.assertEqual(result.debt_to_income, Decimal("5000") / Decimal("30000"))

    def test_investments_do_not_replace_liquid_savings_or_add_goal_returns(self) -> None:
        goal = Goal(
            name="House deposit",
            targetAmount=200000,
            currentAllocation=40000,
            currentContribution=5000,
            targetDate=date(2027, 10, 2),
            priority=1,
        )
        state = FinancialTwinState(
            monthlyIncome=30000,
            monthlyExpenses=20000,
            liquidSavings=40000,
            investments=7000,
            goals=[goal],
        )

        financial_result = calculate_financial_metrics(
            state, essential_monthly_expenses=20000
        )
        goal_result = calculate_goal(goal, as_of_date=date(2026, 10, 2))

        self.assertEqual(state.investments, Decimal("7000"))
        self.assertEqual(state.liquid_savings, Decimal("40000"))
        self.assertEqual(financial_result.emergency_coverage_months, Decimal("2"))
        self.assertEqual(goal.return_assumption, Decimal("0"))
        self.assertEqual(goal_result.projected_amount, Decimal("100000"))

    def test_defaulted_zero_contribution_is_distinguishable_from_explicit_zero(self) -> None:
        omitted = Goal(
            name="Omitted contribution",
            targetAmount=1000,
            currentAllocation=0,
            targetDate=date(2027, 1, 1),
            priority=1,
        )
        explicit_zero = Goal(
            name="Explicit zero contribution",
            targetAmount=1000,
            currentAllocation=0,
            currentContribution=0,
            targetDate=date(2027, 1, 1),
            priority=1,
        )

        omitted_result = calculate_goal(omitted, as_of_date=date(2026, 10, 2))
        explicit_result = calculate_goal(explicit_zero, as_of_date=date(2026, 10, 2))

        self.assertEqual(omitted_result.current_contribution, Decimal("0"))
        self.assertEqual(explicit_result.current_contribution, Decimal("0"))
        self.assertTrue(
            any("contribution defaulted to 0" in item for item in omitted_result.assumptions)
        )
        self.assertFalse(
            any("contribution defaulted to 0" in item for item in explicit_result.assumptions)
        )

    def test_emergency_expense_triggers_liquidity_and_coverage_flags(self) -> None:
        baseline = FinancialTwinState(
            monthlyIncome=30000,
            monthlyExpenses=20000,
            liquidSavings=40000,
        )
        scenario = FinancialTwinState(
            monthlyIncome=30000,
            monthlyExpenses=20000,
            liquidSavings=30000,
        )
        baseline_metrics = calculate_financial_metrics(
            baseline, essential_monthly_expenses=20000
        )
        scenario_metrics = calculate_financial_metrics(
            scenario, essential_monthly_expenses=20000
        )

        result = detect_risk_flags(
            baseline_metrics,
            scenario_metrics,
            baseline_liquid_savings=baseline.liquid_savings,
            scenario_liquid_savings=scenario.liquid_savings,
        )

        self.assertEqual(
            {flag.type for flag in result.flags},
            {
                RiskType.LIQUIDITY_REDUCTION,
                RiskType.EMERGENCY_COVERAGE_REDUCTION,
            },
        )

    def test_each_risk_condition_can_trigger_exactly_its_own_flag(self) -> None:
        baseline = FinancialTwinMetrics(
            monthly_surplus=100,
            savings_rate=Decimal("0.1"),
            debt_to_income=Decimal("0"),
            emergency_coverage_months=Decimal("2"),
            goal_funding_gap=Decimal("100"),
        )
        cases = (
            (
                baseline.model_copy(update={"monthly_surplus": Decimal("-1")}),
                {},
                RiskType.NEGATIVE_SURPLUS,
            ),
            (
                baseline.model_copy(update={"goal_funding_gap": Decimal("101")}),
                {},
                RiskType.GOAL_SHORTFALL,
            ),
            (
                baseline.model_copy(update={"debt_to_income": Decimal("0.01")}),
                {},
                RiskType.HIGHER_DEBT_BURDEN,
            ),
            (
                baseline.model_copy(
                    update={"emergency_coverage_months": Decimal("1.9")}
                ),
                {},
                RiskType.EMERGENCY_COVERAGE_REDUCTION,
            ),
        )
        for scenario_metrics, arguments, expected in cases:
            with self.subTest(expected=expected):
                result = detect_risk_flags(baseline, scenario_metrics, **arguments)
                self.assertEqual([flag.type for flag in result.flags], [expected])

        liquidity_only = detect_risk_flags(
            baseline,
            baseline,
            baseline_liquid_savings=40000,
            scenario_liquid_savings=39000,
        )
        self.assertEqual(
            [flag.type for flag in liquidity_only.flags],
            [RiskType.LIQUIDITY_REDUCTION],
        )

    def test_missing_risk_metrics_remain_unavailable_without_false_flags(self) -> None:
        baseline = FinancialTwinMetrics(
            monthly_surplus=0,
            savings_rate=None,
            debt_to_income=None,
            emergency_coverage_months=None,
            goal_funding_gap=0,
        )
        scenario = FinancialTwinMetrics(
            monthly_surplus=0,
            savings_rate=None,
            debt_to_income=Decimal("0.2"),
            emergency_coverage_months=Decimal("1"),
            goal_funding_gap=0,
        )

        result = detect_risk_flags(baseline, scenario)

        self.assertEqual(result.flags, [])
        self.assertNotIn("score", RiskDetectionResult.model_fields)
        self.assertNotIn("risk_score", RiskDetectionResult.model_fields)

    def test_financial_goal_and_risk_engines_do_not_mutate_inputs(self) -> None:
        goal = Goal(
            name="Emergency fund",
            targetAmount=100000,
            currentAllocation=20000,
            currentContribution=2000,
            targetDate=date(2027, 10, 2),
            priority=1,
        )
        state = FinancialTwinState(
            monthlyIncome=30000,
            monthlyExpenses=20000,
            monthlyDebtPayments=1000,
            liquidSavings=40000,
            investments=5000,
            goals=[goal],
        )
        scenario_state = FinancialTwinState(
            monthlyIncome=30000,
            monthlyExpenses=25000,
            monthlyDebtPayments=1000,
            liquidSavings=30000,
            investments=5000,
            goals=[goal],
        )
        baseline_metrics = calculate_financial_metrics(
            state, essential_monthly_expenses=20000
        )
        scenario_metrics = calculate_financial_metrics(
            scenario_state, essential_monthly_expenses=20000
        )
        snapshots = (
            state.model_dump(),
            goal.model_dump(),
            baseline_metrics.model_dump(),
            scenario_metrics.model_dump(),
        )

        calculate_financial_metrics(state, essential_monthly_expenses=20000)
        calculate_goal(goal, as_of_date=date(2026, 10, 2))
        detect_risk_flags(
            baseline_metrics,
            scenario_metrics,
            baseline_liquid_savings=state.liquid_savings,
            scenario_liquid_savings=scenario_state.liquid_savings,
        )

        self.assertEqual(
            snapshots,
            (
                state.model_dump(),
                goal.model_dump(),
                baseline_metrics.model_dump(),
                scenario_metrics.model_dump(),
            ),
        )


if __name__ == "__main__":
    unittest.main()
