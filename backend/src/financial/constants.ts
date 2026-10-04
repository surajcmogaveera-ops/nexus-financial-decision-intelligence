export const PROVENANCE_TYPES = [
  "USER",
  "COMPUTED",
  "EXTERNAL",
  "RETRIEVED",
  "AI_INTERPRETATION",
  "ASSUMPTION",
] as const;

export type ProvenanceType = (typeof PROVENANCE_TYPES)[number];

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

