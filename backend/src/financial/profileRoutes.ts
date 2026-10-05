import { Router } from "express";
import { createAuthenticationMiddleware } from "../auth/middleware.js";
import type { AuthService } from "../auth/service.js";
import type { FinancialDataRepository } from "./profileRepository.js";
import { getOwnedFinancialTwin } from "./profileService.js";

export function createFinancialProfileRouter(
  repository: FinancialDataRepository,
  auth: AuthService,
) {
  const router = Router();
  router.get("/", createAuthenticationMiddleware(auth), async (request, response, next) => {
    try {
      response.status(200).json(await getOwnedFinancialTwin(request.auth!.userId, repository));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
