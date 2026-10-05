import { runScenario } from "../scenarios/engine.js";
import type { ScenarioResult } from "../scenarios/types.js";
import { AiServiceClient, AiServiceError } from "../ai/client.js";
import { createAiAnalysisRequest, type AiAnalysisResponse } from "../ai/types.js";
import { Provenance } from "../financial/constants.js";
import { CALCULATION_VERSION } from "./constants.js";
import { SimulationServiceError, validateSimulationRequest } from "./schemas.js";
import type { BaselineRequestField, SimulationResponse, SimulationWithAiResponse } from "./types.js";

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

/**
 * Runs the authoritative deterministic calculation first, then requests an
 * optional explanation. Only classified AI-service failures become fallback
 * states; deterministic, programming, and invariant errors still propagate.
 */
export async function simulateWithAi(
  request: unknown,
  aiClient: Pick<AiServiceClient, "analyze"> = new AiServiceClient(),
): Promise<SimulationWithAiResponse> {
  const simulation = simulate(request);
  try {
    const explanation = await aiClient.analyze(
      createAiAnalysisRequest("Explain the deterministic simulation consequences.", simulation),
    );
    if (isNotConfiguredResponse(explanation)) {
      return { ...simulation, ai: unavailableAi("NOT_CONFIGURED") };
    }
    return {
      ...simulation,
      ai: {
        status: "READY",
        explanation,
        provenance: Provenance.AI_INTERPRETATION,
        message: null,
      },
    };
  } catch (error) {
    if (!(error instanceof AiServiceError) || error.code === "INVALID_AI_REQUEST") {
      throw error;
    }
    return {
      ...simulation,
      ai: unavailableAi(error.code === "AI_SERVICE_NOT_CONFIGURED" ? "NOT_CONFIGURED" : "UNAVAILABLE"),
    };
  }
}

function isNotConfiguredResponse(response: AiAnalysisResponse): boolean {
  // FastAPI retains the Hour 12 response contract and represents absent Gemini
  // configuration with its explicit null/empty placeholder response.
  return response.summary === null && response.model === null && response.promptVersion === null;
}

function unavailableAi(status: "NOT_CONFIGURED" | "UNAVAILABLE") {
  return { status, explanation: null, message: "AI explanation unavailable." } as const;
}
