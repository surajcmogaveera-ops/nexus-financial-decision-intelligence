import type {
  GoalCalculationStatus,
  GoalStatus,
  Provenance,
  RiskSeverity,
  RiskType,
} from "./constants.js";

/** Monetary values are canonical decimal strings to avoid binary-float money math. */
export type Money = string;
export type MoneyInput = number | string;

export interface FinancialGoal {
  name: string;
  targetAmount: Money;
  currentAllocatedAmount: Money;
  targetDate?: string;
  /** An explicit deterministic horizon can be used instead of a target date. */
  monthsRemaining?: number;
  /** Omitted profile-level contributions use available cash flow for one goal. */
  monthlyContribution?: Money;
  fundingSource?: string;
  returnAssumption: number;
  priority: number;
  status: GoalStatus;
}

/** Raw, validated user-owned values only; calculations never mutate this object. */
export interface FinancialProfile {
  currency: string;
  monthlyIncome: Money;
  monthlyExpenses: Money;
  monthlyDebtPayments: Money;
  liquidSavings: Money;
  investments: Money;
  monthlyInvestmentContribution: Money;
  essentialMonthlyExpenses?: Money;
  goals: FinancialGoal[];
}

export interface GoalProgress {
  name: string;
  targetAmount: Money;
  currentAllocatedAmount: Money;
  currentFundingGap: Money;
  monthsRemaining: number | null;
  monthlyContributionUsed: Money;
  requiredMonthlyContribution: Money | null;
  projectedAmount: Money | null;
  projectedGoalShortfall: Money | null;
  monthsToGoal: number | null;
  feasible: boolean | null;
  status: GoalCalculationStatus;
  statusMessage: string | null;
}

export interface DerivedFinancialMetrics {
  /** Python-reference definition, before optional investment contributions. */
  monthlySurplus: Money;
  /** Spendable cash flow after the separately represented investment amount. */
  availableMonthlyCashFlow: Money;
  savingsRate: number | null;
  debtToIncome: number | null;
  emergencyCoverageMonths: number | null;
  /** Sum of current goal gaps, matching the Python Financial Twin metric. */
  currentFundingGap: Money;
  requiredMonthlyContribution: Money | null;
  goals: GoalProgress[];
}

export interface RiskFlag {
  type: RiskType;
  severity: RiskSeverity;
  trigger: string;
  /** Stable IDs of the computed comparisons supporting this flag. */
  evidence: string[];
  details: Record<string, string | number | boolean | null>;
}

export interface RiskCalculationEvidence {
  metric: string;
  expression: string;
  baselineValue: number | Money | boolean | null;
  scenarioValue: number | Money | boolean | null;
  result: boolean;
  provenance: Extract<Provenance, "COMPUTED">;
  evidenceId: string;
  /** Present on auditable domain calculations; absent on comparison evidence. */
  type?: "CALCULATION";
  id?: string;
  calculationId?: string;
  inputs?: Record<string, unknown>;
  formula?: string;
  output?: unknown;
  timestamp?: string;
}

/** Full calculation record carried in the canonical H14 evidence collection. */
export type CalculationEvidence = RiskCalculationEvidence & Required<Pick<RiskCalculationEvidence,
  "type" | "id" | "calculationId" | "inputs" | "formula" | "output" | "timestamp"
>>;

export interface RiskDetectionResult {
  flags: RiskFlag[];
  calculations: RiskCalculationEvidence[];
}

export type RawField = keyof Omit<FinancialProfile, "goals"> | "goals";
export type DerivedMetric = keyof DerivedFinancialMetrics;

export interface FinancialTwin {
  raw: FinancialProfile;
  derived: DerivedFinancialMetrics;
  provenance: {
    raw: Partial<Record<RawField, Provenance>>;
    derived: Record<DerivedMetric, Extract<Provenance, "COMPUTED">>;
    goalFields: Array<Partial<Record<keyof FinancialGoal, Provenance>>>;
    assumptions: Extract<Provenance, "ASSUMPTION">;
  };
  riskFlags: RiskFlag[];
  evidence: CalculationEvidence[];
  assumptions: string[];
  calculatedAt: string;
}

export interface FinancialTwinRequest {
  profile: FinancialProfile;
  asOfDate: string;
}
