import { GOAL_STATUSES } from "./constants.js";
import { parseMoney } from "./money.js";
import type {
  FinancialGoal,
  FinancialProfile,
  FinancialTwinRequest,
  Money,
  MoneyInput,
  RawField,
} from "./types.js";

export class InputValidationError extends Error {
  constructor(
    message: string,
    readonly details: Record<string, string> = {},
  ) {
    super(message);
    this.name = "InputValidationError";
  }
}

export interface ParsedFinancialTwinRequest {
  request: FinancialTwinRequest;
  suppliedFields: Set<RawField>;
}

type JsonObject = Record<string, unknown>;

function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknownKeys(value: JsonObject, allowed: string[], path: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new InputValidationError("Request contains unsupported fields", {
      [path]: `Unsupported field(s): ${unknown.join(", ")}`,
    });
  }
}

function parseDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new InputValidationError(`${field} must be an ISO date (YYYY-MM-DD)`, {
      [field]: "Expected a valid YYYY-MM-DD date",
    });
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(date.getTime()) ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new InputValidationError(`${field} must be a real calendar date`, {
      [field]: "Invalid calendar date",
    });
  }
  return value;
}

function parseMoneyField(value: unknown, field: string): Money {
  try {
    return parseMoney(value as MoneyInput, field);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid amount";
    throw new InputValidationError(message, { [field]: message });
  }
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new InputValidationError(`${field} must be a non-empty string`, {
      [field]: "Expected a non-empty string",
    });
  }
  return value.trim();
}

function optionalHorizon(value: unknown, field: string): number | undefined {
  if (value === undefined || value === null) return undefined;
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InputValidationError(`${field} must be a non-negative integer`, {
      [field]: "Expected a non-negative safe integer number of months",
    });
  }
  return value as number;
}

function parseGoalValue(value: unknown, path: string): FinancialGoal {
  if (!isObject(value)) {
    throw new InputValidationError("Each goal must be an object", {
      [path]: "Expected a structured goal object",
    });
  }
  rejectUnknownKeys(
    value,
    [
      "name",
      "targetAmount",
      "currentAllocatedAmount",
      "targetDate",
      "monthsRemaining",
      "monthlyContribution",
      "fundingSource",
      "returnAssumption",
      "priority",
      "status",
    ],
    path,
  );

  const name = optionalString(value.name, `${path}.name`);
  if (!name) {
    throw new InputValidationError("Goal name is required", {
      [`${path}.name`]: "Required",
    });
  }
  if (value.targetAmount === undefined) {
    throw new InputValidationError("Goal target amount is required", {
      [`${path}.targetAmount`]: "Required",
    });
  }
  const targetAmount = parseMoneyField(value.targetAmount, `${path}.targetAmount`);
  const currentAllocatedAmount = value.currentAllocatedAmount === undefined
    ? "0"
    : parseMoneyField(value.currentAllocatedAmount, `${path}.currentAllocatedAmount`);
  const monthlyContribution = value.monthlyContribution === undefined
    ? undefined
    : parseMoneyField(value.monthlyContribution, `${path}.monthlyContribution`);
  const targetDate = value.targetDate === undefined || value.targetDate === null
    ? undefined
    : parseDate(value.targetDate, `${path}.targetDate`);
  const monthsRemaining = optionalHorizon(value.monthsRemaining, `${path}.monthsRemaining`);
  if (targetDate && monthsRemaining !== undefined) {
    throw new InputValidationError(
      "Provide a goal targetDate or monthsRemaining, not both",
      { [path]: "The goal horizon has two competing sources" },
    );
  }

  const returnAssumption = value.returnAssumption === undefined ? 0 : value.returnAssumption;
  if (
    typeof returnAssumption !== "number" ||
    !Number.isFinite(returnAssumption) ||
    returnAssumption < 0
  ) {
    throw new InputValidationError("Goal returnAssumption must be finite and non-negative", {
      [`${path}.returnAssumption`]: "Expected a finite non-negative number",
    });
  }
  const priority = value.priority === undefined ? 1 : value.priority;
  if (!Number.isSafeInteger(priority) || (priority as number) < 1) {
    throw new InputValidationError("Goal priority must be a positive integer", {
      [`${path}.priority`]: "Expected a positive safe integer",
    });
  }
  const status = value.status === undefined ? "active" : value.status;
  if (typeof status !== "string" || !GOAL_STATUSES.some((allowed) => allowed === status)) {
    throw new InputValidationError("Goal status is invalid", {
      [`${path}.status`]: `Expected one of: ${GOAL_STATUSES.join(", ")}`,
    });
  }

  const fundingSource = optionalString(value.fundingSource, `${path}.fundingSource`);
  return {
    name,
    targetAmount,
    currentAllocatedAmount,
    ...(targetDate ? { targetDate } : {}),
    ...(monthsRemaining !== undefined ? { monthsRemaining } : {}),
    ...(monthlyContribution !== undefined ? { monthlyContribution } : {}),
    ...(fundingSource ? { fundingSource } : {}),
    returnAssumption,
    priority: priority as number,
    status: status as FinancialGoal["status"],
  };
}

function parseGoal(value: unknown, index: number): FinancialGoal {
  return parseGoalValue(value, `profile.goals[${index}]`);
}

/** Reuse the Financial Twin goal validation rules for persistence-backed goal APIs. */
export function parseFinancialGoal(value: unknown, field = "goal"): FinancialGoal {
  return parseGoalValue(value, field);
}

export function parseFinancialTwinRequest(body: unknown): ParsedFinancialTwinRequest {
  if (!isObject(body)) {
    throw new InputValidationError("Request body must be a JSON object", {
      body: "Expected an object",
    });
  }
  rejectUnknownKeys(body, ["profile", "asOfDate"], "request");
  if (!isObject(body.profile)) {
    throw new InputValidationError("profile is required and must be an object", {
      profile: "Expected an object",
    });
  }
  const source = body.profile;
  rejectUnknownKeys(
    source,
    [
      "currency",
      "monthlyIncome",
      "monthlyExpenses",
      "monthlyDebtPayments",
      "liquidSavings",
      "investments",
      "monthlyInvestmentContribution",
      "essentialMonthlyExpenses",
      "goals",
    ],
    "profile",
  );
  for (const required of ["monthlyIncome", "monthlyExpenses", "liquidSavings"] as const) {
    if (source[required] === undefined) {
      throw new InputValidationError(`profile.${required} is required`, {
        [`profile.${required}`]: "Required",
      });
    }
  }

  const currency = source.currency === undefined ? "INR" : source.currency;
  if (
    typeof currency !== "string" ||
    !/^[A-Z]{3}$/.test(currency)
  ) {
    throw new InputValidationError("profile.currency must be a 3-letter uppercase code", {
      "profile.currency": "Expected three uppercase letters",
    });
  }
  if (source.goals !== undefined && !Array.isArray(source.goals)) {
    throw new InputValidationError("profile.goals must be an array", {
      "profile.goals": "Expected an array of structured goals",
    });
  }

  const goals = (source.goals as unknown[] | undefined)?.map(parseGoal) ?? [];
  const profile: FinancialProfile = {
    currency,
    monthlyIncome: parseMoneyField(source.monthlyIncome, "profile.monthlyIncome"),
    monthlyExpenses: parseMoneyField(source.monthlyExpenses, "profile.monthlyExpenses"),
    monthlyDebtPayments: source.monthlyDebtPayments === undefined
      ? "0"
      : parseMoneyField(source.monthlyDebtPayments, "profile.monthlyDebtPayments"),
    liquidSavings: parseMoneyField(source.liquidSavings, "profile.liquidSavings"),
    investments: source.investments === undefined
      ? "0"
      : parseMoneyField(source.investments, "profile.investments"),
    monthlyInvestmentContribution: source.monthlyInvestmentContribution === undefined
      ? "0"
      : parseMoneyField(
        source.monthlyInvestmentContribution,
        "profile.monthlyInvestmentContribution",
      ),
    ...(source.essentialMonthlyExpenses === undefined || source.essentialMonthlyExpenses === null
      ? {}
      : {
        essentialMonthlyExpenses: parseMoneyField(
          source.essentialMonthlyExpenses,
          "profile.essentialMonthlyExpenses",
        ),
      }),
    goals,
  };

  const asOfDate = body.asOfDate === undefined
    ? new Date().toISOString().slice(0, 10)
    : parseDate(body.asOfDate, "asOfDate");
  const suppliedFields = new Set<RawField>();
  for (const field of ["monthlyIncome", "monthlyExpenses", "liquidSavings"] as const) {
    suppliedFields.add(field);
  }
  if (source.currency !== undefined) suppliedFields.add("currency");
  if (source.goals !== undefined) suppliedFields.add("goals");
  for (const field of [
    "monthlyDebtPayments",
    "investments",
    "monthlyInvestmentContribution",
    "essentialMonthlyExpenses",
  ] as const) {
    if (source[field] !== undefined) suppliedFields.add(field);
  }

  return { request: { profile, asOfDate }, suppliedFields };
}

