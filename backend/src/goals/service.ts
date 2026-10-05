import { ApiResourceError } from "../api/errors.js";
import { calculateGoalProgress, monthsBetweenDates } from "../financial/engine/goalProgress.js";
import { InputValidationError, parseFinancialGoal } from "../financial/schemas.js";
import { storedGoalToFinancialGoal } from "../financial/profileMapper.js";
import type { FinancialDataRepository, GoalWriteData, StoredGoal } from "../financial/profileRepository.js";
import type { FinancialGoal, GoalProgress } from "../financial/types.js";

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function invalidGoal(error: unknown): ApiResourceError {
  return new ApiResourceError(
    "INVALID_GOAL",
    error instanceof Error ? error.message : "Goal input is invalid.",
    error instanceof InputValidationError ? error.details : {},
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rejectManagedStatus(value: Record<string, unknown>): void {
  if ("status" in value) {
    throw new ApiResourceError("INVALID_GOAL", "Goal status is managed by the application and cannot be set through this API.", {
      status: "Unsupported field",
    });
  }
}

function goalHorizon(goal: FinancialGoal, asOfDate: string): number | null {
  if (goal.monthsRemaining !== undefined) return goal.monthsRemaining;
  if (!goal.targetDate) return null;
  return monthsBetweenDates(asOfDate, goal.targetDate);
}

function derivedGoal(goal: FinancialGoal, asOfDate: string): GoalProgress {
  return calculateGoalProgress(goal, goalHorizon(goal, asOfDate), goal.monthlyContribution ?? "0");
}

function dateString(value: Date | string | null): string | null {
  if (value === null) return null;
  return typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);
}

const RAW_GOAL_FIELDS = [
  "name", "targetAmount", "currentAllocatedAmount", "targetDate", "monthsRemaining",
  "monthlyContribution", "fundingSource", "returnAssumption", "priority",
] as const;

function goalResponse(record: StoredGoal, derived: GoalProgress) {
  return {
    id: record.id,
    name: record.name,
    targetAmount: String(record.targetAmount),
    currentAllocatedAmount: String(record.currentAllocatedAmount),
    targetDate: dateString(record.targetDate),
    monthsRemaining: record.monthsRemaining,
    monthlyContribution: String(record.monthlyContribution),
    fundingSource: record.fundingSource,
    returnAssumption: record.returnAssumption === null ? 0 : Number(String(record.returnAssumption)),
    priority: record.priority,
    status: record.status,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    derived,
    provenance: {
      raw: Object.fromEntries(RAW_GOAL_FIELDS.map((field) => [field, "USER"])),
      derived: Object.fromEntries(Object.keys(derived).map((field) => [field, "COMPUTED"])),
    },
  };
}

function writeData(goal: FinancialGoal): GoalWriteData {
  return {
    name: goal.name,
    targetAmount: goal.targetAmount,
    currentAllocatedAmount: goal.currentAllocatedAmount,
    targetDate: goal.targetDate ? new Date(`${goal.targetDate}T00:00:00.000Z`) : null,
    monthsRemaining: goal.monthsRemaining ?? null,
    monthlyContribution: goal.monthlyContribution ?? "0",
    fundingSource: goal.fundingSource ?? null,
    returnAssumption: goal.returnAssumption,
    priority: goal.priority,
    status: goal.status,
  };
}

function parseCreateGoal(value: unknown, asOfDate: string): { goal: FinancialGoal; derived: GoalProgress } {
  if (!isObject(value)) throw new ApiResourceError("INVALID_GOAL", "Request body must be a goal object.", { body: "Expected an object" });
  rejectManagedStatus(value);
  try {
    const goal = parseFinancialGoal(value);
    return { goal, derived: derivedGoal(goal, asOfDate) };
  } catch (error) {
    throw invalidGoal(error);
  }
}

function parseUpdateGoal(value: unknown, previous: FinancialGoal, asOfDate: string): { goal: FinancialGoal; derived: GoalProgress } {
  if (!isObject(value)) throw new ApiResourceError("INVALID_GOAL", "Request body must be a goal object.", { body: "Expected an object" });
  if (Object.keys(value).length === 0) throw new ApiResourceError("INVALID_GOAL", "At least one raw goal field must be updated.", { body: "Empty update" });
  rejectManagedStatus(value);
  const merged: Record<string, unknown> = { ...previous, ...value };
  if (value.targetDate !== undefined && value.targetDate !== null && value.monthsRemaining === undefined) {
    merged.monthsRemaining = undefined;
  }
  if (value.monthsRemaining !== undefined && value.monthsRemaining !== null && value.targetDate === undefined) {
    merged.targetDate = undefined;
  }
  try {
    const goal = parseFinancialGoal(merged);
    return { goal, derived: derivedGoal(goal, asOfDate) };
  } catch (error) {
    throw invalidGoal(error);
  }
}

function profileNotFound(): ApiResourceError {
  return new ApiResourceError("FINANCIAL_PROFILE_NOT_FOUND", "Financial profile not found.");
}

function goalNotFound(): ApiResourceError {
  return new ApiResourceError("GOAL_NOT_FOUND", "Goal not found.");
}

function orderedGoals(goals: StoredGoal[]): StoredGoal[] {
  return [...goals].sort((left, right) =>
    left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id));
}

export async function listOwnedGoals(userId: string, repository: FinancialDataRepository, asOfDate = todayUtc()) {
  const profile = await repository.findProfileByUserId(userId);
  if (!profile) throw profileNotFound();
  const goals = orderedGoals(await repository.listGoals(profile.id));
  return goals.map((record, index) => {
    const goal = storedGoalToFinancialGoal(record, index);
    return goalResponse(record, derivedGoal(goal, asOfDate));
  });
}

export async function createOwnedGoal(userId: string, input: unknown, repository: FinancialDataRepository, asOfDate = todayUtc()) {
  const profile = await repository.findProfileByUserId(userId);
  if (!profile) throw profileNotFound();
  const { goal, derived } = parseCreateGoal(input, asOfDate);
  const persisted = await repository.createGoal(profile.id, writeData(goal));
  return goalResponse(persisted, derived);
}

export async function updateOwnedGoal(
  userId: string,
  id: string,
  input: unknown,
  repository: FinancialDataRepository,
  asOfDate = todayUtc(),
) {
  const profile = await repository.findProfileByUserId(userId);
  if (!profile) throw profileNotFound();
  const existing = await repository.findGoalForProfile(id, profile.id);
  if (!existing) throw goalNotFound();
  const previous = storedGoalToFinancialGoal(existing);
  const { goal, derived } = parseUpdateGoal(input, previous, asOfDate);
  const updated = await repository.updateGoalForProfile(id, profile.id, writeData(goal));
  if (!updated) throw goalNotFound();
  return goalResponse(updated, derived);
}
