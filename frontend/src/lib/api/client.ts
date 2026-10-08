export interface ApiErrorBody {
  code?: string;
  message?: string;
  details?: Record<string, unknown>;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code: string,
    details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const configuredBaseUrl = process.env.NEXT_PUBLIC_API_BASE_URL?.trim();
const apiBaseUrl = (configuredBaseUrl || "http://127.0.0.1:3000").replace(/\/+$/, "");

type Decoder<T> = (value: unknown) => T;

async function requestJson<T>(path: string, decode: Decoder<T>, init: RequestInit = {}): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new ApiClientError("The API path must be a local application route.", 0, "INVALID_API_PATH");
  }

  let response: Response;
  try {
    response = await fetch(`${apiBaseUrl}${path}`, {
      ...init,
      credentials: "include",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        ...(init.body ? { "Content-Type": "application/json" } : {}),
        ...init.headers,
      },
    });
  } catch {
    throw new ApiClientError("The NEXUS backend could not be reached. Check that it is running and try again.", 0, "API_UNAVAILABLE");
  }

  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = isApiErrorBody(payload) ? payload.error : undefined;
    throw new ApiClientError(
      error?.message || `The backend request failed (${response.status}).`,
      response.status,
      error?.code || "API_ERROR",
      error?.details || {},
    );
  }

  if (payload === null) {
    throw new ApiClientError("The backend returned an invalid response.", response.status, "INVALID_API_RESPONSE");
  }
  try {
    return decode(payload);
  } catch {
    throw new ApiClientError("The backend returned data in an unexpected format.", response.status, "INVALID_API_RESPONSE");
  }
}

function isApiErrorBody(value: unknown): value is { error?: ApiErrorBody } {
  return typeof value === "object" && value !== null && "error" in value;
}

export interface SafeUser {
  id: string;
  email: string;
  name: string | null;
}

export type ProvenanceLabel = "USER" | "COMPUTED" | "EXTERNAL" | "RETRIEVED" | "AI_INTERPRETATION" | "ASSUMPTION";
export type GoalStatus = "active" | "completed" | "paused";
export type GoalCalculationStatus = "FUNDED" | "ON_TRACK" | "SHORTFALL" | "UNREACHABLE" | "UNAVAILABLE";

export interface FinancialGoalInput {
  name: string;
  targetAmount: string;
  currentAllocatedAmount: string;
  targetDate?: string;
  monthsRemaining?: number;
  monthlyContribution?: string;
  fundingSource?: string;
  returnAssumption: number;
  priority: number;
  status: GoalStatus;
}

export interface GoalProgress {
  name: string;
  targetAmount: string;
  currentAllocatedAmount: string;
  currentFundingGap: string;
  monthsRemaining: number | null;
  monthlyContributionUsed: string;
  requiredMonthlyContribution: string | null;
  projectedAmount: string | null;
  projectedGoalShortfall: string | null;
  monthsToGoal: number | null;
  feasible: boolean | null;
  status: GoalCalculationStatus;
  statusMessage: string | null;
}

export interface FinancialRiskFlag {
  type: string;
  severity: string;
  trigger: string;
  evidence: string[];
  details: Record<string, string | number | boolean | null>;
}

export interface FinancialTwin {
  raw: {
    currency: string;
    monthlyIncome: string;
    monthlyExpenses: string;
    monthlyDebtPayments: string;
    liquidSavings: string;
    investments: string;
    monthlyInvestmentContribution: string;
    essentialMonthlyExpenses?: string;
    goals: FinancialGoalInput[];
  };
  derived: {
    monthlySurplus: string;
    availableMonthlyCashFlow: string;
    savingsRate: number | null;
    debtToIncome: number | null;
    emergencyCoverageMonths: number | null;
    currentFundingGap: string;
    requiredMonthlyContribution: string | null;
    goals: GoalProgress[];
  };
  provenance: {
    raw: Partial<Record<keyof FinancialTwin["raw"], ProvenanceLabel>>;
    derived: Partial<Record<keyof FinancialTwin["derived"], ProvenanceLabel>>;
    goalFields: Array<Partial<Record<keyof FinancialGoalInput, ProvenanceLabel>>>;
    assumptions: "ASSUMPTION";
  };
  riskFlags: FinancialRiskFlag[];
  assumptions: string[];
  calculatedAt: string;
}

const provenanceLabels = new Set<ProvenanceLabel>([
  "USER", "COMPUTED", "EXTERNAL", "RETRIEVED", "AI_INTERPRETATION", "ASSUMPTION",
]);
const goalStatuses = new Set<GoalStatus>(["active", "completed", "paused"]);
const goalCalculationStatuses = new Set<GoalCalculationStatus>([
  "FUNDED", "ON_TRACK", "SHORTFALL", "UNREACHABLE", "UNAVAILABLE",
]);
const moneyPattern = /^-?\d+(?:\.\d+)?$/;

function objectValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isMoney(value: unknown): value is string {
  return typeof value === "string" && moneyPattern.test(value);
}

function isNullableMoney(value: unknown): value is string | null {
  return value === null || isMoney(value);
}

function isNullableNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function decodeUserEnvelope(value: unknown): { user: SafeUser } {
  const body = objectValue(value);
  const user = objectValue(body?.user);
  if (!user || !isString(user.id) || !isString(user.email) || !(user.name === null || isString(user.name))) {
    throw new TypeError("Invalid user response");
  }
  return { user: { id: user.id, email: user.email, name: user.name } };
}

function isRecordOfStrings(value: unknown): value is Record<string, string> {
  const record = objectValue(value);
  return record !== null && Object.values(record).every(isString);
}

function isRawGoal(value: unknown): value is FinancialGoalInput {
  const goal = objectValue(value);
  return Boolean(goal && isString(goal.name) && isMoney(goal.targetAmount) && isMoney(goal.currentAllocatedAmount)
    && (goal.targetDate === undefined || isString(goal.targetDate))
    && (goal.monthsRemaining === undefined || (Number.isSafeInteger(goal.monthsRemaining) && (goal.monthsRemaining as number) >= 0))
    && (goal.monthlyContribution === undefined || isMoney(goal.monthlyContribution))
    && (goal.fundingSource === undefined || goal.fundingSource === null || isString(goal.fundingSource))
    && typeof goal.returnAssumption === "number" && Number.isFinite(goal.returnAssumption)
    && typeof goal.priority === "number" && Number.isFinite(goal.priority)
    && isString(goal.status) && goalStatuses.has(goal.status as GoalStatus));
}

function isGoalProgress(value: unknown): value is GoalProgress {
  const goal = objectValue(value);
  return Boolean(goal && isString(goal.name) && isMoney(goal.targetAmount) && isMoney(goal.currentAllocatedAmount)
    && isMoney(goal.currentFundingGap) && isNullableNumber(goal.monthsRemaining)
    && isMoney(goal.monthlyContributionUsed) && isNullableMoney(goal.requiredMonthlyContribution)
    && isNullableMoney(goal.projectedAmount) && isNullableMoney(goal.projectedGoalShortfall)
    && isNullableNumber(goal.monthsToGoal)
    && (goal.feasible === null || typeof goal.feasible === "boolean")
    && isString(goal.status) && goalCalculationStatuses.has(goal.status as GoalCalculationStatus)
    && (goal.statusMessage === null || isString(goal.statusMessage)));
}

function isRiskFlag(value: unknown): value is FinancialRiskFlag {
  const flag = objectValue(value);
  const details = objectValue(flag?.details);
  return Boolean(flag && isString(flag.type) && isString(flag.severity) && isString(flag.trigger)
    && isStringArray(flag.evidence) && details
    && Object.values(details).every((item) => item === null || isString(item) || typeof item === "boolean" || (typeof item === "number" && Number.isFinite(item))));
}

function decodeFinancialTwin(value: unknown): FinancialTwin {
  const body = objectValue(value);
  const raw = objectValue(body?.raw);
  const derived = objectValue(body?.derived);
  const provenance = objectValue(body?.provenance);
  const rawProvenance = objectValue(provenance?.raw);
  const derivedProvenance = objectValue(provenance?.derived);
  const goalProvenance = provenance?.goalFields;
  if (!body || !raw || !derived || !provenance || !rawProvenance || !derivedProvenance
    || !/^[A-Z]{3}$/.test(String(raw.currency))
    || !isMoney(raw.monthlyIncome) || !isMoney(raw.monthlyExpenses) || !isMoney(raw.monthlyDebtPayments)
    || !isMoney(raw.liquidSavings) || !isMoney(raw.investments) || !isMoney(raw.monthlyInvestmentContribution)
    || !(raw.essentialMonthlyExpenses === undefined || isMoney(raw.essentialMonthlyExpenses))
    || !Array.isArray(raw.goals) || !raw.goals.every(isRawGoal)
    || !isMoney(derived.monthlySurplus) || !isMoney(derived.availableMonthlyCashFlow)
    || !isNullableNumber(derived.savingsRate) || !isNullableNumber(derived.debtToIncome)
    || !isNullableNumber(derived.emergencyCoverageMonths) || !isMoney(derived.currentFundingGap)
    || !isNullableMoney(derived.requiredMonthlyContribution)
    || !Array.isArray(derived.goals) || !derived.goals.every(isGoalProgress)
    || derived.goals.length !== raw.goals.length
    || !Array.isArray(goalProvenance) || goalProvenance.length !== raw.goals.length || !goalProvenance.every(isRecordOfStrings)
    || ![...Object.values(rawProvenance), ...Object.values(derivedProvenance), ...goalProvenance.flatMap((entry) => Object.values(entry))]
      .every((label) => typeof label === "string" && provenanceLabels.has(label as ProvenanceLabel))
    || provenance.assumptions !== "ASSUMPTION"
    || !Array.isArray(body.riskFlags) || !body.riskFlags.every(isRiskFlag)
    || !isStringArray(body.assumptions) || !isString(body.calculatedAt)) {
    throw new TypeError("Invalid Financial Twin response");
  }
  return value as FinancialTwin;
}

function decodeOkStatus(value: unknown): { status: "ok" } {
  const body = objectValue(value);
  if (body?.status !== "ok") throw new TypeError("Invalid status response");
  return { status: "ok" };
}

export const api = {
  register(input: { name: string; email: string; password: string }) {
    return requestJson("/api/auth/register", decodeUserEnvelope, { method: "POST", body: JSON.stringify(input) });
  },
  login(input: { email: string; password: string }) {
    return requestJson("/api/auth/login", decodeUserEnvelope, { method: "POST", body: JSON.stringify(input) });
  },
  logout() {
    return requestJson("/api/auth/logout", decodeOkStatus, { method: "POST" });
  },
  currentUser() {
    return requestJson("/api/auth/me", decodeUserEnvelope);
  },
  financialTwin() {
    return requestJson("/api/financial-twin", decodeFinancialTwin);
  },
};
