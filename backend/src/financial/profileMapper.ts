import { decimalToMinorUnits, minorUnitsToMoney, parseMoney } from "./money.js";
import { parseFinancialGoal } from "./schemas.js";
import type { FinancialProfile, Money } from "./types.js";
import type { FinancialProfileRecord, StoredDecimal } from "./profileRepository.js";

export class FinancialProfileDataError extends Error {
  constructor(message: string, readonly details: Record<string, string> = {}) {
    super(message);
    this.name = "FinancialProfileDataError";
  }
}

function decimal(value: StoredDecimal, field: string): Money {
  try {
    return parseMoney(String(value), field);
  } catch (error) {
    throw new FinancialProfileDataError("Stored financial data is invalid.", {
      [field]: error instanceof Error ? error.message : "Invalid stored amount",
    });
  }
}

const MONTHLY_RATES: Record<string, readonly [bigint, bigint]> = {
  daily: [365n, 12n],
  weekly: [52n, 12n],
  biweekly: [26n, 12n],
  monthly: [1n, 1n],
  quarterly: [1n, 3n],
  annually: [1n, 12n],
};

/** Normalize persisted recurring amounts to cents using deterministic half-even rounding. */
export function normalizeStoredMonthlyAmount(value: StoredDecimal, frequency: string, field: string): Money {
  const rate = MONTHLY_RATES[frequency.trim().toLowerCase()];
  if (!rate) throw new FinancialProfileDataError("Stored financial data uses an unsupported frequency.", {
    [field]: `Unsupported frequency: ${frequency}`,
  });
  const [numerator, denominator] = rate;
  const minor = decimalToMinorUnits(decimal(value, field), field);
  const scaled = minor * numerator;
  let quotient = scaled / denominator;
  const remainder = scaled % denominator;
  if (remainder * 2n > denominator || (remainder * 2n === denominator && quotient % 2n !== 0n)) quotient += 1n;
  return minorUnitsToMoney(quotient);
}

function sum(values: Money[]): Money {
  return minorUnitsToMoney(values.reduce(
    (total, value) => total + decimalToMinorUnits(value, "financial total"),
    0n,
  ));
}

function requiredValue(field: string, aggregate: StoredDecimal | null, fallback: Money[]): Money {
  if (aggregate !== null) return decimal(aggregate, field);
  if (fallback.length === 0) {
    throw new FinancialProfileDataError("Financial profile is missing required raw data.", {
      [field]: "Provide a profile aggregate or at least one active related record",
    });
  }
  return sum(fallback);
}

function optionalValue(aggregate: StoredDecimal | null, fallback: Money[]): Money | undefined {
  if (aggregate !== null) return decimal(aggregate, "financial profile aggregate");
  return fallback.length ? sum(fallback) : undefined;
}

function storedDate(value: Date | string | null): string | undefined {
  if (value === null) return undefined;
  if (typeof value === "string") return value.slice(0, 10);
  return value.toISOString().slice(0, 10);
}

export function storedGoalToFinancialGoal(goal: FinancialProfileRecord["goals"][number], index = 0) {
  return parseFinancialGoal({
    name: goal.name,
    targetAmount: String(goal.targetAmount),
    currentAllocatedAmount: String(goal.currentAllocatedAmount),
    ...(storedDate(goal.targetDate) ? { targetDate: storedDate(goal.targetDate) } : {}),
    ...(goal.monthsRemaining !== null ? { monthsRemaining: goal.monthsRemaining } : {}),
    monthlyContribution: String(goal.monthlyContribution),
    ...(goal.fundingSource ? { fundingSource: goal.fundingSource } : {}),
    returnAssumption: goal.returnAssumption === null ? 0 : Number(String(goal.returnAssumption)),
    priority: goal.priority,
    status: goal.status,
  }, `profile.goals[${index}]`);
}

/** Maps PostgreSQL raw fields/line items into the existing Financial Engine input contract. */
export function mapFinancialProfileRecord(record: FinancialProfileRecord): FinancialProfile {
  const incomes = record.monthlyIncome === null
    ? record.incomeSources.filter((item) => item.isActive).map((item) =>
      normalizeStoredMonthlyAmount(item.amount, item.frequency, `incomeSources.${item.name}`))
    : [];
  const expenses = record.monthlyExpenses === null
    ? record.expenseCategories.filter((item) => item.isActive).map((item) =>
      normalizeStoredMonthlyAmount(item.amount, item.frequency, `expenseCategories.${item.name}`))
    : [];
  const essentialExpenses = record.essentialMonthlyExpenses === null
    ? record.expenseCategories.filter((item) => item.isActive && item.isEssential).map((item) =>
      normalizeStoredMonthlyAmount(item.amount, item.frequency, `essentialExpenses.${item.name}`))
    : [];
  const activeDebts = record.debts.filter((item) => item.isActive);
  const debtPayments = record.monthlyDebtPayments === null
    ? activeDebts.map((item) => normalizeStoredMonthlyAmount(item.monthlyPayment, item.paymentFrequency, `debts.${item.name}`))
    : [];

  const incomeSources = requiredValue("monthlyIncome", record.monthlyIncome, incomes);
  const monthlyExpenses = requiredValue("monthlyExpenses", record.monthlyExpenses, expenses);
  const liquidAssetValues = record.liquidSavings === null
    ? record.assets.filter((item) => item.isLiquid).map((item) => decimal(item.currentValue, `assets.${item.name}`))
    : [];
  const liquidSavings = requiredValue("liquidSavings", record.liquidSavings, liquidAssetValues);
  const investments = optionalValue(
    record.investments,
    record.investments === null ? record.investmentsList.map((item) => decimal(item.currentValue, `investments.${item.name}`)) : [],
  );
  const investmentContributions = record.investmentsList.flatMap((item) =>
    item.monthlyContribution === null ? [] : [decimal(item.monthlyContribution, `investments.${item.name}.monthlyContribution`)]);

  const monthlyDebtPayments = optionalValue(record.monthlyDebtPayments, debtPayments);
  const monthlyInvestmentContribution = optionalValue(record.monthlyInvestmentContribution, investmentContributions);
  const essentialMonthlyExpenses = optionalValue(record.essentialMonthlyExpenses, essentialExpenses);
  const profile: FinancialProfile = {
    currency: record.currency,
    monthlyIncome: incomeSources,
    monthlyExpenses,
    liquidSavings,
    goals: record.goals.map(storedGoalToFinancialGoal),
    ...(monthlyDebtPayments !== undefined
      ? { monthlyDebtPayments }
      : {}),
    ...(investments !== undefined ? { investments } : {}),
    ...(monthlyInvestmentContribution !== undefined
      ? { monthlyInvestmentContribution }
      : {}),
    ...(essentialMonthlyExpenses !== undefined
      ? { essentialMonthlyExpenses }
      : {}),
  } as FinancialProfile;
  return profile;
}
