import { Router } from "express";
import { createUserContextMiddleware } from "../auth/middleware.js";
import type { UserContextResolver } from "../auth/context.js";
import type { FinancialDataRepository } from "./profileRepository.js";
import { getOwnedFinancialTwin } from "./profileService.js";

export function createFinancialProfileRouter(
  repository: FinancialDataRepository,
  resolveUserContext: UserContextResolver,
) {
  const router = Router();
  router.get("/", createUserContextMiddleware(resolveUserContext), async (request, response, next) => {
    try {
      const user = request.authenticatedUser!;
      response.status(200).json(await getOwnedFinancialTwin(user.userId, repository));
    } catch (error) {
      next(error);
    }
  });
  return router;
}
