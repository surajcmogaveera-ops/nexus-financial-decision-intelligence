import { runScenario } from "../scenarios/engine.js";
import type { ScenarioResult } from "../scenarios/types.js";
import { CALCULATION_VERSION } from "./constants.js";
import { SimulationServiceError, validateSimulationRequest } from "./schemas.js";
import type { BaselineRequestField, SimulationResponse } from "./types.js";

/** Shared orchestration entry point used by both simulation HTTP routes. */
export function executeSimulation(
  request: unknown,
  baselineField: BaselineRequestField = "baseline",
): ScenarioResult {
  const validated = validateSimulationRequest(request, baselineField);
  try {
    return runScenario(validated.baseline, validated.scenario);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new SimulationServiceError("INVALID_SCENARIO", error.message, { scenario: error.message });
    }
    throw new SimulationServiceError("CALCULATION_ERROR", "The deterministic simulation could not be calculated.");
  }
}

/** Maps the authoritative Scenario Engine result into the versioned API contract. */
export function mapScenarioResultToSimulationResponse(result: ScenarioResult): SimulationResponse {
  const evidence = result.evidence;
  return {
    baseline: {
      raw: result.baselineState.raw,
      derived: result.baselineMetrics,
      provenance: result.baselineState.provenance,
      evidence,
    },
    scenario: {
      type: result.scenarioType,
      status: result.status,
      raw: result.scenarioState.raw,
      derived: result.scenarioMetrics,
      provenance: result.scenarioState.provenance,
      evidence,
    },
    delta: result.delta,
    riskFlags: result.riskFlags,
    assumptions: result.assumptions,
    calculationVersion: CALCULATION_VERSION,
  };
}

export function simulate(request: unknown): SimulationResponse {
  return mapScenarioResultToSimulationResponse(executeSimulation(request));
}
