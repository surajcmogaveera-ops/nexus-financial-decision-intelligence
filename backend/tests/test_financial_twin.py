import unittest
from datetime import date
from decimal import Decimal

from pydantic import ValidationError

from app.engine.financial_metrics import (
    UNREACHABLE_GOAL_MESSAGE,
    calculate_financial_metrics,
    debt_to_income,
    emergency_coverage_months,
    goal_gap,
    goal_unreachable_message,
    monthly_surplus,
    months_to_goal,
    projected_goal_amount,
    required_monthly_contribution,
    savings_rate,
    scenario_delta,
)
from app.evidence.provenance import ProvenanceType
from app.models.financial_twin import FinancialTwinState
from app.models.goal import Goal


class FinancialTwinModelTests(unittest.TestCase):
    def test_valid_raw_financial_state(self) -> None:
        state = FinancialTwinState(
            monthlyIncome=30000,
            monthlyExpenses=20000,
            liquidSavings=40000,
            monthlyDebtPayments=0,
            investments=0,
            goals=[],
        )

        self.assertEqual(state.monthly_income, Decimal("30000"))
        self.assertEqual(state.goals, [])
        self.assertNotIn("monthly_surplus", FinancialTwinState.model_fields)

    def test_rejects_negative_raw_monetary_values(self) -> None:
        for field in (
            "monthlyIncome",
            "monthlyExpenses",
            "liquidSavings",
            "monthlyDebtPayments",
            "investments",
        ):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                inputs = {
                    "monthlyIncome": 30000,
                    "monthlyExpenses": 20000,
                    "liquidSavings": 40000,
                    "monthlyDebtPayments": 0,
                    "investments": 0,
                }
                inputs[field] = -1
                FinancialTwinState(**inputs)

    def test_rejects_negative_goal_monetary_values(self) -> None:
        base = {
            "name": "Emergency fund",
            "targetAmount": 10000,
            "targetDate": date(2027, 1, 1),
            "priority": 1,
        }
        for field in ("targetAmount", "currentAllocatedAmount", "monthlyContribution"):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                inputs = {**base, field: -1}
                Goal(**inputs)

    def test_goal_requires_structured_data_and_valid_date(self) -> None:
        with self.assertRaises(ValidationError):
            FinancialTwinState(
                monthlyIncome=1,
                monthlyExpenses=1,
                liquidSavings=0,
                goals=[{"unstructured": "goal"}],
            )
        with self.assertRaises(ValidationError):
            Goal(
                name="Emergency fund",
                targetAmount=100,
                targetDate="not-a-date",
                priority=1,
            )


class FinancialTwinMetricsTests(unittest.TestCase):
    def setUp(self) -> None:
        self.state = FinancialTwinState(
            monthlyIncome=30000,
            monthlyExpenses=20000,
            liquidSavings=40000,
            monthlyDebtPayments=0,
        )

    def test_monthly_surplus_calculation(self) -> None:
        self.assertEqual(
            calculate_financial_metrics(self.state).monthly_surplus, Decimal("10000")
        )

    def test_monthly_surplus_rejects_negative_inputs(self) -> None:
        with self.assertRaises(ValueError):
            monthly_surplus(-1, 0, 0)
        with self.assertRaises(ValueError):
            monthly_surplus(1, -1, 0)

    def test_savings_rate_calculation(self) -> None:
        result = savings_rate(
            monthly_surplus(30000, 20000, 0), 30000
        )
        self.assertAlmostEqual(float(result), 0.3333, places=4)

    def test_zero_income_savings_rate_is_unavailable(self) -> None:
        self.assertIsNone(savings_rate(0, 0))

    def test_debt_to_income_calculation(self) -> None:
        state = self.state.model_copy(update={"monthly_debt_payments": Decimal("3000")})
        self.assertEqual(
            debt_to_income(3000, 30000),
            Decimal("0.1"),
        )

    def test_zero_income_debt_to_income_is_unavailable(self) -> None:
        self.assertIsNone(debt_to_income(0, 0))

    def test_emergency_coverage_calculation(self) -> None:
        self.assertEqual(
            emergency_coverage_months(40000, 20000),
            Decimal("2"),
        )

    def test_missing_or_zero_essential_expenses_make_coverage_unavailable(self) -> None:
        self.assertIsNone(emergency_coverage_months(40000, None))
        self.assertIsNone(emergency_coverage_months(40000, 0))

    def test_goal_funding_gap_calculation_uses_goal_inputs(self) -> None:
        goal = Goal(
            name="House deposit",
            targetAmount=50000,
            currentAllocatedAmount=10000,
            targetDate=date(2028, 1, 1),
            monthlyContribution=500,
            priority=1,
        )
        state = self.state.model_copy(update={"goals": [goal]})
        self.assertEqual(
            goal_gap(50000, 10000),
            Decimal("40000"),
        )

    def test_required_monthly_contribution(self) -> None:
        self.assertEqual(
            required_monthly_contribution(200000, 40000, 12),
            Decimal("13333.33333333333333333333333"),
        )
        self.assertIsNone(required_monthly_contribution(200000, 40000, 0))
        self.assertIsNone(required_monthly_contribution(200000, 40000, 1.5))

    def test_projected_goal_amount(self) -> None:
        self.assertEqual(projected_goal_amount(40000, 5000, 12), Decimal("100000"))

    def test_months_to_goal_rounds_up(self) -> None:
        self.assertEqual(months_to_goal(200000, 40000, 5000), 32)

    def test_already_completed_goal_takes_zero_months(self) -> None:
        self.assertEqual(months_to_goal(10000, 12000, 500), 0)

    def test_unreachable_goal_is_not_given_an_invented_timeline(self) -> None:
        self.assertIsNone(months_to_goal(10000, 5000, 0))
        self.assertEqual(
            goal_unreachable_message(200000, 40000, 5000, 12),
            UNREACHABLE_GOAL_MESSAGE,
        )

    def test_scenario_absolute_and_percentage_delta(self) -> None:
        result = scenario_delta(100, 125)
        self.assertEqual(result.delta, Decimal("25"))
        self.assertEqual(result.percentage_delta, Decimal("25"))

    def test_zero_baseline_percentage_delta_is_unavailable(self) -> None:
        result = scenario_delta(0, 25)
        self.assertEqual(result.delta, Decimal("25"))
        self.assertIsNone(result.percentage_delta)

    def test_zero_income_ratios_are_unavailable(self) -> None:
        state = self.state.model_copy(
            update={
                "monthly_income": Decimal("0"),
                "monthly_debt_payments": Decimal("0"),
            }
        )
        result = calculate_financial_metrics(state)
        self.assertIsNone(result.savings_rate)
        self.assertIsNone(result.debt_to_income)

    def test_zero_expenses_coverage_is_unavailable(self) -> None:
        self.assertIsNone(emergency_coverage_months(40000, 0))

    def test_metrics_require_explicit_essential_expenses(self) -> None:
        self.assertIsNone(calculate_financial_metrics(self.state).emergency_coverage_months)
        metrics = calculate_financial_metrics(
            self.state, essential_monthly_expenses=20000
        )
        self.assertEqual(metrics.emergency_coverage_months, Decimal("2"))

    def test_deterministic_repeatability(self) -> None:
        first = calculate_financial_metrics(
            self.state, essential_monthly_expenses=20000
        )
        second = calculate_financial_metrics(
            self.state, essential_monthly_expenses=20000
        )
        self.assertEqual(first, second)

    def test_provenance_enum_values(self) -> None:
        self.assertEqual(
            {item.value for item in ProvenanceType},
            {"USER", "COMPUTED", "EXTERNAL", "RETRIEVED", "AI_INTERPRETATION"},
        )


if __name__ == "__main__":
    unittest.main()
