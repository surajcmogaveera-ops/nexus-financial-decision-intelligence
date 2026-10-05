import { randomUUID } from "node:crypto";
import type { DerivedFinancialMetrics, FinancialProfile, FinancialTwin, RiskCalculationEvidence, RiskFlag } from "../financial/types.js";
import type { ScenarioDelta } from "../scenarios/types.js";
import type { SimulationResponse } from "../simulations/types.js";
import { CALCULATION_VERSION } from "../simulations/constants.js";

export interface AiFinancialTwinContext {
  raw: FinancialProfile;
  derived: DerivedFinancialMetrics;
  provenance: FinancialTwin["provenance"];
}

export interface AiAnalysisRequest {
  requestId: string;
  question: string;
  financialTwin: AiFinancialTwinContext;
  baseline: SimulationResponse["baseline"];
  scenario: SimulationResponse["scenario"];
  delta: ScenarioDelta;
  riskFlags: RiskFlag[];
  assumptions: string[];
  evidence: RiskCalculationEvidence[];
  calculationVersion: typeof CALCULATION_VERSION;
}

export interface AiAnalysisResponse {
  requestId: string;
  status: "READY";
  summary: string | null;
  keyChanges: string[];
  tradeoffs: string[];
  riskFlags: RiskFlag[];
  evidenceRefs: string[];
  assumptions: string[];
  limitations: string[];
  model: string | null;
  promptVersion: string | null;
  calculationVersion: typeof CALCULATION_VERSION;
}

/** Packages already-calculated Node results; request correlation does not enter calculations. */
export function createAiAnalysisRequest(
  question: string,
  result: SimulationResponse,
  requestId = randomUUID(),
): AiAnalysisRequest {
  return {
    requestId,
    question,
    financialTwin: {
      raw: result.baseline.raw,
      derived: result.baseline.derived,
      provenance: result.baseline.provenance,
    },
    baseline: result.baseline,
    scenario: result.scenario,
    delta: result.delta,
    riskFlags: result.riskFlags,
    assumptions: result.assumptions,
    evidence: result.scenario.evidence,
    calculationVersion: CALCULATION_VERSION,
  };
}
