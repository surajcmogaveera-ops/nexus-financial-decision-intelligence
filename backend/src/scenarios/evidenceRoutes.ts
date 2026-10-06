import { Router } from "express";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import { ApiResourceError } from "../api/errors.js";
import { getEvidenceLedger } from "./evidenceLedger.js";
import type { ScenarioEvidenceRepository } from "./repository.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createEvidenceRouter(repository: ScenarioEvidenceRepository, auth: AuthService) {
  const router = Router();
  router.use(createAuthenticationMiddleware(auth));
  router.get("/:scenarioId", async (request, response, next) => {
    try {
      const scenarioId = request.params.scenarioId ?? "";
      if (!UUID_PATTERN.test(scenarioId)) throw new ApiResourceError("SCENARIO_NOT_FOUND", "Scenario not found.");
      const ledger = await getEvidenceLedger(request.auth!.userId, scenarioId, repository);
      if (!ledger) throw new ApiResourceError("SCENARIO_NOT_FOUND", "Scenario not found.");
      response.status(200).json(ledger);
    } catch (error) {
      next(error);
    }
  });
  return router;
}
