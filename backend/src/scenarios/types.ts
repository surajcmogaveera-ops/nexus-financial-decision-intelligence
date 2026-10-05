import type { FinancialProfile, FinancialTwin, DerivedFinancialMetrics, RiskCalculationEvidence, RiskFlag, Money } from "../financial/types.js";
import type { Provenance } from "../financial/constants.js";

export const SCENARIO_TYPES = [
  "INVESTMENT_CHANGE",
  "INCOME_SHOCK",
  "EXPENSE_CHANGE",
  "RENT_CHANGE",
  "EMERGENCY_EXPENSE",
  "DEBT_CHANGE",
  "GOAL_CHANGE",
  "MARKET_STRESS",
] as const;

export type ScenarioType = (typeof SCENARIO_TYPES)[number];

export type ScenarioInput =
  | { type: "INVESTMENT_CHANGE"; monthlyInvestmentContribution: Money }
  | { type: "INCOME_SHOCK"; percentageBasisPoints?: number; amountDelta?: Money }
  | { type: "EXPENSE_CHANGE"; percentageBasisPoints?: number; amountDelta?: Money }
  | { type: "RENT_CHANGE"; monthlyRentDelta: Money }
  | { type: "EMERGENCY_EXPENSE"; amount: Money }
  | { type: "DEBT_CHANGE"; monthlyPaymentDelta: Money }
  | { type: "GOAL_CHANGE"; goalName: string; targetAmount?: Money; currentAllocatedAmount?: Money; monthsRemaining?: number }
  | { type: "MARKET_STRESS"; stressBasisPoints: number };

export interface ScenarioState {
  raw: FinancialProfile;
  provenance: {
    raw: FinancialTwin["provenance"]["raw"];
    derived: FinancialTwin["provenance"]["derived"];
    goalFields: FinancialTwin["provenance"]["goalFields"];
    assumptions: Extract<Provenance, "ASSUMPTION">;
  };
}

export interface ScenarioMetricDelta {
  delta: number | Money | null;
  percentageDelta: number | null;
}

export interface ScenarioDelta {
  monthlySurplus: ScenarioMetricDelta;
  availableMonthlyCashFlow: ScenarioMetricDelta;
  savingsRate: ScenarioMetricDelta;
  debtToIncome: ScenarioMetricDelta;
  emergencyCoverageMonths: ScenarioMetricDelta;
  currentFundingGap: ScenarioMetricDelta;
  projectedAmount: ScenarioMetricDelta;
  projectedGoalShortfall: ScenarioMetricDelta;
  liquidityImpact: ScenarioMetricDelta;
  additionalScenarioShortfall: Money | null;
}

export interface ScenarioResult {
  scenarioId: string;
  scenarioType: ScenarioType;
  status: "COMPLETED" | "UNSUPPORTED";
  baselineState: { raw: FinancialProfile; provenance: ScenarioState["provenance"] };
  scenarioState: ScenarioState;
  baselineMetrics: DerivedFinancialMetrics;
  scenarioMetrics: DerivedFinancialMetrics;
  delta: ScenarioDelta;
  riskFlags: RiskFlag[];
  evidence: RiskCalculationEvidence[];
  assumptions: string[];
  provenance: {
    scenarioTransform: Extract<Provenance, "COMPUTED">;
    scenarioDerived: Extract<Provenance, "COMPUTED">;
    assumptions: Extract<Provenance, "ASSUMPTION">;
  };
  calculatedAt: string;
}
