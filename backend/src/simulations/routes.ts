import { Router } from "express";
import { AiServiceClient } from "../ai/client.js";
import { simulateWithAi } from "./service.js";
import { createOptionalAuthenticationMiddleware } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import { ApiResourceError } from "../api/errors.js";
import type { ScenarioEvidenceRepository } from "../scenarios/repository.js";

export function createSimulationRouter(
  aiServiceClient: Pick<AiServiceClient, "analyze"> = new AiServiceClient(),
  scenarioEvidenceRepository?: ScenarioEvidenceRepository,
  auth?: AuthService,
) {
  const simulationRouter = Router();
  if (auth) simulationRouter.use(createOptionalAuthenticationMiddleware(auth));

  simulationRouter.post("/", async (request, response, next) => {
    try {
      const result = await simulateWithAi(request.body, aiServiceClient, request.auth && scenarioEvidenceRepository
        ? async (simulation) => {
          const scenarioId = await scenarioEvidenceRepository.createForUser(
            request.auth!.userId, simulation, request.body?.scenario,
          );
          if (!scenarioId) throw new ApiResourceError("FINANCIAL_PROFILE_NOT_FOUND", "A saved financial profile is required to persist this scenario.");
          return scenarioId;
        }
        : undefined);
      response.status(200).json(result);
    } catch (error) {
      next(error);
    }
  });

  return simulationRouter;
}
