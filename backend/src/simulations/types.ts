import type { DerivedFinancialMetrics, FinancialProfile, FinancialTwin, RiskCalculationEvidence, RiskFlag } from "../financial/types.js";
import type { ScenarioDelta, ScenarioInput, ScenarioState, ScenarioType } from "../scenarios/types.js";
import type { CALCULATION_VERSION } from "./constants.js";
import type { AiAnalysisResponse } from "../ai/types.js";
import type { Provenance } from "../financial/constants.js";
import type { AiVerificationResult } from "../verification/types.js";
import type { RetrievalResult } from "../rag/types.js";

export type BaselineRequestField = "baseline" | "profile";

export interface SimulationBaseline {
  raw: FinancialProfile;
  derived: DerivedFinancialMetrics;
  provenance: FinancialTwin["provenance"];
  evidence: RiskCalculationEvidence[];
}

export interface SimulationScenario {
  type: ScenarioType;
  status: "COMPLETED" | "UNSUPPORTED";
  raw: ScenarioState["raw"];
  derived: DerivedFinancialMetrics;
  provenance: ScenarioState["provenance"];
  evidence: RiskCalculationEvidence[];
}

export interface SimulationResponse {
  /** Present when an authenticated run was persisted for Evidence Ledger access. */
  scenarioId?: string;
  baseline: SimulationBaseline;
  scenario: SimulationScenario;
  delta: ScenarioDelta;
  riskFlags: RiskFlag[];
  assumptions: string[];
  calculationVersion: typeof CALCULATION_VERSION;
}

export type SimulationAiResult =
  | { status: "READY"; explanation: AiAnalysisResponse; provenance: Extract<Provenance, "AI_INTERPRETATION">; message: null }
  | { status: "NOT_CONFIGURED" | "UNAVAILABLE"; explanation: null; message: "AI explanation unavailable." };

export type SimulationVerificationResult = AiVerificationResult
  | { status: "NOT_APPLICABLE"; issues: []; message: "AI explanation is unavailable." };

/** Flagship response: the deterministic simulation remains top-level and authoritative. */
export interface SimulationWithAiResponse extends SimulationResponse {
  ai: SimulationAiResult;
  retrieval: RetrievalResult;
  verification: SimulationVerificationResult;
}

export interface ValidatedSimulationRequest {
  baseline: ReturnType<typeof import("../financial/schemas.js").parseFinancialTwinRequest>;
  scenario: ScenarioInput;
}
