import unittest
from datetime import date
from decimal import Decimal

from pydantic import ValidationError

from app.engine.goal_engine import (
    GoalCalculationStatus,
    calculate_goal,
    calculate_goals,
    months_between_dates,
)
from app.evidence.provenance import ProvenanceType
from app.models.financial_twin import FinancialTwinState
from app.models.goal import Goal


AS_OF = date(2026, 10, 2)


def make_goal(**overrides) -> Goal:
    values = {
        "name": "Emergency fund",
        "targetAmount": 200000,
        "currentAllocation": 40000,
        "targetDate": date(2027, 10, 2),
        "currentContribution": 5000,
        "priority": 1,
    }
    values.update(overrides)
    return Goal(**values)


class GoalModelTests(unittest.TestCase):
    def test_goal_accepts_new_and_legacy_api_field_names(self) -> None:
        current_names = make_goal()
        legacy_names = Goal(
            name="Legacy goal",
            targetAmount=1,
            currentAllocatedAmount=2,
            targetDate=date(2027, 1, 1),
            monthlyContribution=3,
            priority=1,
        )
        self.assertEqual(current_names.current_allocation, Decimal("40000"))
        self.assertEqual(current_names.current_contribution, Decimal("5000"))
        self.assertEqual(legacy_names.current_allocation, Decimal("2"))
        self.assertEqual(legacy_names.current_contribution, Decimal("3"))
        legacy_json = legacy_names.model_dump(by_alias=True)
        self.assertIn("currentAllocatedAmount", legacy_json)
        self.assertIn("monthlyContribution", legacy_json)

    def test_zero_defaults_are_explicit_and_return_is_zero_by_default(self) -> None:
        goal = Goal(name="No date", targetAmount=100, priority=1)
        self.assertEqual(goal.current_allocation, Decimal("0"))
        self.assertEqual(goal.current_contribution, Decimal("0"))
        self.assertEqual(goal.return_assumption, Decimal("0"))
        self.assertIsNone(goal.target_date)

    def test_missing_target_amount_is_validation_error(self) -> None:
        with self.assertRaises(ValidationError):
            Goal(name="Incomplete", targetDate=date(2027, 1, 1), priority=1)

    def test_negative_goal_money_and_return_values_are_rejected(self) -> None:
        base = {
            "name": "Invalid goal",
            "targetAmount": 1,
            "currentAllocation": 1,
            "targetDate": date(2027, 1, 1),
            "currentContribution": 1,
            "returnAssumption": 0,
            "priority": 1,
        }
        for field in (
            "targetAmount",
            "currentAllocation",
            "currentContribution",
            "returnAssumption",
        ):
            with self.subTest(field=field), self.assertRaises(ValidationError):
                Goal(**{**base, field: -1})


class GoalDateTests(unittest.TestCase):
    def test_target_date_equal_to_as_of_date_has_zero_months(self) -> None:
        self.assertEqual(months_between_dates(AS_OF, AS_OF), 0)

    def test_future_date_in_same_month_rounds_up_to_one_month(self) -> None:
        self.assertEqual(
            months_between_dates(date(2026, 10, 2), date(2026, 10, 3)), 1
        )

    def test_month_count_uses_calendar_months_and_rounds_partial_month_up(self) -> None:
        self.assertEqual(
            months_between_dates(date(2026, 10, 2), date(2026, 11, 2)), 1
        )
        self.assertEqual(
            months_between_dates(date(2026, 10, 2), date(2026, 11, 3)), 2
        )

    def test_month_count_handles_year_boundary(self) -> None:
        self.assertEqual(
            months_between_dates(date(2026, 12, 31), date(2027, 1, 1)), 1
        )

    def test_target_date_in_past_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "target_date must not be before"):
            calculate_goal(make_goal(targetDate=date(2026, 10, 1)), as_of_date=AS_OF)


class GoalEngineTests(unittest.TestCase):
    def test_normal_goal_gap_projection_and_feasibility(self) -> None:
        result = calculate_goal(make_goal(), as_of_date=AS_OF)
        self.assertEqual(result.goal_gap, Decimal("160000"))
        self.assertEqual(result.months_remaining, 12)
        self.assertEqual(
            result.required_monthly_contribution,
            Decimal("13333.33333333333333333333333"),
        )
        self.assertEqual(result.projected_amount, Decimal("100000"))
        self.assertEqual(result.months_to_goal, 32)
        self.assertFalse(result.feasible)
        self.assertEqual(result.calculation_status, GoalCalculationStatus.SHORTFALL)
        self.assertIsNotNone(result.status_message)

    def test_fully_funded_goal_with_zero_contribution(self) -> None:
        result = calculate_goal(
            make_goal(
                targetAmount=100000,
                currentAllocation=100000,
                currentContribution=0,
            ),
            as_of_date=AS_OF,
        )
        self.assertEqual(result.goal_gap, Decimal("0"))
        self.assertEqual(result.months_to_goal, 0)
        self.assertTrue(result.feasible)
        self.assertEqual(result.calculation_status, GoalCalculationStatus.FUNDED)

    def test_already_overfunded_gap_is_zero(self) -> None:
        result = calculate_goal(
            make_goal(targetAmount=100000, currentAllocation=120000),
            as_of_date=AS_OF,
        )
        self.assertEqual(result.goal_gap, Decimal("0"))
        self.assertTrue(result.feasible)

    def test_zero_contribution_for_unfunded_goal_is_unreachable(self) -> None:
        result = calculate_goal(make_goal(currentContribution=0), as_of_date=AS_OF)
        self.assertEqual(result.goal_gap, Decimal("160000"))
        self.assertIsNone(result.months_to_goal)
        self.assertFalse(result.feasible)
        self.assertEqual(result.calculation_status, GoalCalculationStatus.UNREACHABLE)
        self.assertIn("not reachable", result.status_message)

    def test_zero_month_horizon_does_not_divide_by_zero(self) -> None:
        result = calculate_goal(
            make_goal(targetDate=AS_OF),
            as_of_date=AS_OF,
        )
        self.assertEqual(result.months_remaining, 0)
        self.assertIsNone(result.required_monthly_contribution)
        self.assertEqual(result.projected_amount, Decimal("40000"))
        self.assertFalse(result.feasible)
        self.assertIn("required_monthly_contribution", result.unavailable_fields)

    def test_missing_target_date_marks_horizon_calculations_unavailable(self) -> None:
        result = calculate_goal(make_goal(targetDate=None), as_of_date=AS_OF)
        self.assertIsNone(result.months_remaining)
        self.assertIsNone(result.required_monthly_contribution)
        self.assertIsNone(result.projected_amount)
        self.assertIsNone(result.feasible)
        self.assertEqual(result.calculation_status, GoalCalculationStatus.UNAVAILABLE)
        self.assertIn("months_remaining", result.unavailable_fields)

    def test_missing_date_does_not_mask_funded_goal(self) -> None:
        result = calculate_goal(
            make_goal(
                targetAmount=100000,
                currentAllocation=100000,
                targetDate=None,
                currentContribution=0,
            ),
            as_of_date=AS_OF,
        )
        self.assertEqual(result.calculation_status, GoalCalculationStatus.FUNDED)
        self.assertEqual(result.goal_gap, Decimal("0"))
        self.assertTrue(result.feasible)
        self.assertIsNone(result.projected_amount)

    def test_zero_return_is_explicit_and_uses_simple_projection(self) -> None:
        goal = make_goal(returnAssumption=0)
        result = calculate_goal(goal, as_of_date=AS_OF)
        self.assertEqual(result.return_assumption, Decimal("0"))
        self.assertEqual(result.projected_amount, Decimal("100000"))
        self.assertIn("No investment return assumed", result.assumptions[0])

    def test_nonzero_return_is_not_silently_used(self) -> None:
        result = calculate_goal(make_goal(returnAssumption="0.05"), as_of_date=AS_OF)
        self.assertEqual(result.calculation_status, GoalCalculationStatus.UNAVAILABLE)
        self.assertIsNone(result.projected_amount)
        self.assertIsNone(result.required_monthly_contribution)
        self.assertIsNone(result.feasible)
        self.assertTrue(any("not implemented" in item for item in result.assumptions))

    def test_zero_income_or_expenses_do_not_affect_goal_calculation(self) -> None:
        state = FinancialTwinState(
            monthlyIncome=0,
            monthlyExpenses=0,
            liquidSavings=0,
            goals=[make_goal()],
        )
        result = calculate_goals(state.goals, as_of_date=AS_OF)[0]
        self.assertEqual(result.projected_amount, Decimal("100000"))

    def test_multiple_goals_are_calculated_independently(self) -> None:
        first = make_goal(name="First", targetAmount=100000, currentAllocation=0)
        second = make_goal(name="Second", targetAmount=50000, currentAllocation=10000)
        results = calculate_goals([first, second], as_of_date=AS_OF)
        self.assertEqual([item.goal_gap for item in results], [Decimal("100000"), Decimal("40000")])
        self.assertEqual([item.projected_amount for item in results], [Decimal("60000"), Decimal("70000")])

    def test_calculation_evidence_uses_computed_provenance_and_stable_ids(self) -> None:
        goal = make_goal()
        first = calculate_goal(goal, as_of_date=AS_OF)
        second = calculate_goal(goal, as_of_date=AS_OF)
        self.assertEqual(first.evidence, second.evidence)
        self.assertTrue(
            {record.calculation for record in first.evidence}.issuperset(
                {
                    "goal_gap",
                    "months_remaining",
                    "required_monthly_contribution",
                    "projected_goal_amount",
                    "months_to_goal",
                    "goal_feasibility",
                }
            )
        )
        for record in first.evidence:
            self.assertEqual(record.provenance, ProvenanceType.COMPUTED)
            self.assertRegex(record.evidence_id, r"^CALC-[0-9A-F]{12}$")

    def test_goal_result_does_not_add_derived_values_to_raw_model(self) -> None:
        self.assertNotIn("goal_gap", Goal.model_fields)
        self.assertNotIn("projected_amount", Goal.model_fields)
        self.assertNotIn("feasible", Goal.model_fields)


if __name__ == "__main__":
    unittest.main()
