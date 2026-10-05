/** Canonical origin labels shared by Financial Twin, scenarios, evidence, and AI output. */
export const Provenance = {
  USER: "USER",
  COMPUTED: "COMPUTED",
  EXTERNAL: "EXTERNAL",
  RETRIEVED: "RETRIEVED",
  AI_INTERPRETATION: "AI_INTERPRETATION",
  ASSUMPTION: "ASSUMPTION",
} as const;

export type Provenance = (typeof Provenance)[keyof typeof Provenance];

const provenanceValues: ReadonlySet<string> = new Set(Object.values(Provenance));

export function isProvenance(value: unknown): value is Provenance {
  return typeof value === "string" && provenanceValues.has(value);
}

export const GOAL_STATUSES = ["active", "completed", "paused"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

export const GOAL_CALCULATION_STATUSES = [
  "FUNDED",
  "ON_TRACK",
  "SHORTFALL",
  "UNREACHABLE",
  "UNAVAILABLE",
] as const;
export type GoalCalculationStatus =
  (typeof GOAL_CALCULATION_STATUSES)[number];

export const RISK_TYPES = [
  "LIQUIDITY_REDUCTION",
  "GOAL_SHORTFALL",
  "NEGATIVE_SURPLUS",
  "HIGHER_DEBT_BURDEN",
  "EMERGENCY_COVERAGE_REDUCTION",
  "MISSING_DATA",
] as const;
export type RiskType = (typeof RISK_TYPES)[number];

export const RISK_SEVERITIES = ["low", "medium", "high"] as const;
export type RiskSeverity = (typeof RISK_SEVERITIES)[number];

