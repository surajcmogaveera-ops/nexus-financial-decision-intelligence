import { decimalToMinorUnits, minorUnitsToMoney, parseMoney } from "../financial/money.js";
import { InputValidationError } from "../financial/schemas.js";
import type { Money } from "../financial/types.js";
import { SCENARIO_TYPES, type ScenarioInput, type ScenarioType } from "./types.js";

type JsonObject = Record<string, unknown>;
function isObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function rejectUnknown(value: JsonObject, allowed: string[]): void {
  const keys = Object.keys(value).filter((key) => !allowed.includes(key));
  if (keys.length) throw new InputValidationError("Scenario contains unsupported fields", {
    scenario: `Unsupported field(s): ${keys.join(", ")}`,
  });
}
function requiredMoney(value: unknown, field: string, allowNegative = false): Money {
  try {
    if (allowNegative) return minorUnitsToMoney(decimalToMinorUnits(value as string | number, field, true));
    return parseMoney(value as string | number, field);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid amount";
    throw new InputValidationError(message, { [`scenario.${field}`]: message });
  }
}
function percentage(value: unknown, field: string, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < min || (value as number) > max) {
    throw new InputValidationError(`${field} is outside the supported range`, {
      [`scenario.${field}`]: `Expected an integer from ${min} to ${max} basis points`,
    });
  }
  return value as number;
}
function horizon(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new InputValidationError("monthsRemaining must be a non-negative integer", {
      "scenario.monthsRemaining": "Expected a non-negative safe integer",
    });
  }
  return value as number;
}

export function parseScenarioInput(value: unknown): ScenarioInput {
  if (!isObject(value)) throw new InputValidationError("scenario must be an object", { scenario: "Expected an object" });
  if (typeof value.type !== "string" || !SCENARIO_TYPES.includes(value.type as ScenarioType)) {
    throw new InputValidationError("scenario.type is invalid", { "scenario.type": `Expected one of: ${SCENARIO_TYPES.join(", ")}` });
  }
  switch (value.type as ScenarioType) {
    case "INVESTMENT_CHANGE":
      rejectUnknown(value, ["type", "monthlyInvestmentContribution"]);
      return { type: value.type as "INVESTMENT_CHANGE", monthlyInvestmentContribution: requiredMoney(value.monthlyInvestmentContribution, "monthlyInvestmentContribution") };
    case "INCOME_SHOCK":
    case "EXPENSE_CHANGE": {
      rejectUnknown(value, ["type", "percentageBasisPoints", "amountDelta"]);
      const hasPercent = value.percentageBasisPoints !== undefined;
      const hasDelta = value.amountDelta !== undefined;
      if (hasPercent === hasDelta) throw new InputValidationError("Provide exactly one scenario change", {
        scenario: "Provide percentageBasisPoints or amountDelta",
      });
      const change = hasPercent
        ? { percentageBasisPoints: percentage(value.percentageBasisPoints, "percentageBasisPoints", -10000, 100000) }
        : { amountDelta: requiredMoney(value.amountDelta, "amountDelta", true) };
      return { type: value.type as "INCOME_SHOCK" | "EXPENSE_CHANGE", ...change } as ScenarioInput;
    }
    case "RENT_CHANGE":
      rejectUnknown(value, ["type", "monthlyRentDelta"]);
      return { type: value.type as "RENT_CHANGE", monthlyRentDelta: requiredMoney(value.monthlyRentDelta, "monthlyRentDelta", true) };
    case "EMERGENCY_EXPENSE":
      rejectUnknown(value, ["type", "amount"]);
      return { type: value.type as "EMERGENCY_EXPENSE", amount: requiredMoney(value.amount, "amount") };
    case "DEBT_CHANGE":
      rejectUnknown(value, ["type", "monthlyPaymentDelta"]);
      return { type: value.type as "DEBT_CHANGE", monthlyPaymentDelta: requiredMoney(value.monthlyPaymentDelta, "monthlyPaymentDelta", true) };
    case "GOAL_CHANGE": {
      rejectUnknown(value, ["type", "goalName", "targetAmount", "currentAllocatedAmount", "monthsRemaining"]);
      if (typeof value.goalName !== "string" || !value.goalName.trim()) {
        throw new InputValidationError("goalName is required", { "scenario.goalName": "Expected a non-empty goal name" });
      }
      const changes: Partial<Extract<ScenarioInput, { type: "GOAL_CHANGE" }>> = {};
      if (value.targetAmount !== undefined) changes.targetAmount = requiredMoney(value.targetAmount, "targetAmount");
      if (value.currentAllocatedAmount !== undefined) changes.currentAllocatedAmount = requiredMoney(value.currentAllocatedAmount, "currentAllocatedAmount");
      if (value.monthsRemaining !== undefined) changes.monthsRemaining = horizon(value.monthsRemaining);
      if (!Object.keys(changes).length) throw new InputValidationError("GOAL_CHANGE requires at least one change", {
        scenario: "Provide targetAmount, currentAllocatedAmount, or monthsRemaining",
      });
      return { type: value.type as "GOAL_CHANGE", goalName: value.goalName.trim(), ...changes };
    }
    case "MARKET_STRESS":
      rejectUnknown(value, ["type", "stressBasisPoints"]);
      return { type: value.type as "MARKET_STRESS", stressBasisPoints: percentage(value.stressBasisPoints, "stressBasisPoints", -10000, 0) };
  }
}
