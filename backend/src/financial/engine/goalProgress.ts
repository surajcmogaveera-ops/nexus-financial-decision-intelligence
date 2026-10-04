import { GOAL_CALCULATION_STATUSES } from "../constants.js";
import { addMoney, decimalToMinorUnits, divideMoney, minorUnitsToMoney, multiplyMoney } from "../money.js";
import type { FinancialGoal, GoalProgress, Money } from "../types.js";

export const UNREACHABLE_GOAL_MESSAGE =
  "Goal is not reachable within the selected horizon under the current assumptions.";

export function calculateCurrentFundingGap(targetAmount: Money, currentAllocated: Money): Money {
  const gap = decimalToMinorUnits(targetAmount, "targetAmount") -
    decimalToMinorUnits(currentAllocated, "currentAllocatedAmount");
  return minorUnitsToMoney(gap > 0n ? gap : 0n);
}

export function calculateRequiredContribution(
  targetAmount: Money,
  currentAllocated: Money,
  monthsRemaining: number | null,
): Money | null {
  const gap = calculateCurrentFundingGap(targetAmount, currentAllocated);
  if (gap === "0") return "0";
  if (monthsRemaining === null || !Number.isSafeInteger(monthsRemaining) || monthsRemaining <= 0) {
    return null;
  }
  return divideMoney(gap, monthsRemaining);
}

export function projectGoal(
  currentAllocated: Money,
  monthlyContribution: Money,
  months: number,
): Money {
  if (!Number.isSafeInteger(months) || months < 0) {
    throw new TypeError("months must be a non-negative safe integer");
  }
  return addMoney(currentAllocated, multiplyMoney(monthlyContribution, months));
}

export function calculateMonthsToGoal(
  targetAmount: Money,
  currentAllocated: Money,
  monthlyContribution: Money,
): number | null {
  const gap = decimalToMinorUnits(calculateCurrentFundingGap(targetAmount, currentAllocated), "current funding gap");
  if (gap === 0n) return 0;
  const contribution = decimalToMinorUnits(monthlyContribution, "monthlyContribution");
  if (contribution <= 0n) return null;
  const months = (gap + contribution - 1n) / contribution;
  const result = Number(months);
  if (!Number.isSafeInteger(result)) throw new TypeError("goal horizon exceeds supported range");
  return result;
}

export function monthsBetweenDates(asOfDate: string, targetDate: string): number {
  if (targetDate < asOfDate) throw new TypeError("targetDate must not be before asOfDate");
  if (targetDate === asOfDate) return 0;
  const [asOfYear, asOfMonth, asOfDay] = asOfDate.split("-").map(Number);
  const [targetYear, targetMonth, targetDay] = targetDate.split("-").map(Number);
  const difference = (targetYear - asOfYear) * 12 + targetMonth - asOfMonth;
  return Math.max(1, difference + (targetDay > asOfDay ? 1 : 0));
}

function addDecimalStrings(left: string, right: string): string {
  const scale = Math.max(left.split(".")[1]?.length ?? 0, right.split(".")[1]?.length ?? 0);
  const factor = 10n ** BigInt(scale);
  const toScaled = (value: string): bigint => {
    const negative = value.startsWith("-");
    const unsigned = negative ? value.slice(1) : value;
    const [whole, fraction = ""] = unsigned.split(".");
    const scaled = BigInt(whole) * factor + BigInt(fraction.padEnd(scale, "0") || "0");
    return negative ? -scaled : scaled;
  };
  const total = toScaled(left) + toScaled(right);
  const negative = total < 0n;
  const absolute = negative ? -total : total;
  const whole = absolute / factor;
  const fraction = scale === 0 ? "" : (absolute % factor).toString().padStart(scale, "0").replace(/0+$/, "");
  return `${negative && absolute !== 0n ? "-" : ""}${whole}${fraction ? `.${fraction}` : ""}`;
}

export function calculateGoalProgress(
  goal: FinancialGoal,
  monthsRemaining: number | null,
  monthlyContribution: Money = goal.monthlyContribution ?? "0",
): GoalProgress {
  const gap = calculateCurrentFundingGap(goal.targetAmount, goal.currentAllocatedAmount);
  const funded = gap === "0";
  const monthsToGoal = calculateMonthsToGoal(
    goal.targetAmount,
    goal.currentAllocatedAmount,
    monthlyContribution,
  );

  if (funded) {
    return {
      name: goal.name,
      targetAmount: goal.targetAmount,
      currentAllocatedAmount: goal.currentAllocatedAmount,
      currentFundingGap: gap,
      monthsRemaining,
      monthlyContributionUsed: monthlyContribution,
      requiredMonthlyContribution: "0",
      projectedAmount: monthsRemaining === null || goal.returnAssumption !== 0
        ? null
        : projectGoal(goal.currentAllocatedAmount, monthlyContribution, monthsRemaining),
      projectedGoalShortfall: monthsRemaining === null || goal.returnAssumption !== 0
        ? null
        : "0",
      monthsToGoal: 0,
      feasible: true,
      status: "FUNDED",
      statusMessage: null,
    };
  }

  if (goal.returnAssumption !== 0) {
    return unavailableProgress(goal, gap, monthsRemaining, monthlyContribution, "UNAVAILABLE");
  }

  if (monthsRemaining === null) {
    return unavailableProgress(
      goal,
      gap,
      null,
      monthlyContribution,
      monthsToGoal === null ? "UNREACHABLE" : "UNAVAILABLE",
    );
  }

  const required = calculateRequiredContribution(
    goal.targetAmount,
    goal.currentAllocatedAmount,
    monthsRemaining,
  );
  const projected = projectGoal(
    goal.currentAllocatedAmount,
    monthlyContribution,
    monthsRemaining,
  );
  const projectedGap = calculateCurrentFundingGap(goal.targetAmount, projected);
  const feasible = projectedGap === "0";
  const status = monthsToGoal === null
    ? "UNREACHABLE"
    : feasible
      ? "ON_TRACK"
      : "SHORTFALL";

  return {
    name: goal.name,
    targetAmount: goal.targetAmount,
    currentAllocatedAmount: goal.currentAllocatedAmount,
    currentFundingGap: gap,
    monthsRemaining,
    monthlyContributionUsed: monthlyContribution,
    requiredMonthlyContribution: required,
    projectedAmount: projected,
    projectedGoalShortfall: projectedGap,
    monthsToGoal,
    feasible,
    status,
    statusMessage: status === "SHORTFALL" || status === "UNREACHABLE"
      ? UNREACHABLE_GOAL_MESSAGE
      : null,
  };
}

function unavailableProgress(
  goal: FinancialGoal,
  gap: Money,
  monthsRemaining: number | null,
  monthlyContribution: Money,
  status: (typeof GOAL_CALCULATION_STATUSES)[number],
): GoalProgress {
  return {
    name: goal.name,
    targetAmount: goal.targetAmount,
    currentAllocatedAmount: goal.currentAllocatedAmount,
    currentFundingGap: gap,
    monthsRemaining,
    monthlyContributionUsed: monthlyContribution,
    requiredMonthlyContribution: null,
    projectedAmount: null,
    projectedGoalShortfall: null,
    monthsToGoal: null,
    feasible: null,
    status,
    statusMessage: status === "UNREACHABLE" ? UNREACHABLE_GOAL_MESSAGE : null,
  };
}

export function sumDecimalAmounts(values: Array<string | null>): string | null {
  if (values.some((value) => value === null)) return null;
  return values.reduce<string>((total, value) => addDecimalStrings(total, value!), "0");
}

