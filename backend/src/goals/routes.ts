import { Router } from "express";
import { createUserContextMiddleware } from "../auth/middleware.js";
import type { UserContextResolver } from "../auth/context.js";
import type { FinancialDataRepository } from "../financial/profileRepository.js";
import { createOwnedGoal, listOwnedGoals, updateOwnedGoal } from "./service.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function createGoalsRouter(repository: FinancialDataRepository, resolveUserContext: UserContextResolver) {
  const router = Router();
  router.use(createUserContextMiddleware(resolveUserContext));

  router.get("/", async (request, response, next) => {
    try {
      response.status(200).json(await listOwnedGoals(request.authenticatedUser!.userId, repository));
    } catch (error) {
      next(error);
    }
  });

  router.post("/", async (request, response, next) => {
    try {
      response.status(201).json(await createOwnedGoal(request.authenticatedUser!.userId, request.body, repository));
    } catch (error) {
      next(error);
    }
  });

  router.put("/:id", async (request, response, next) => {
    try {
      if (!UUID_PATTERN.test(request.params.id ?? "")) {
        response.status(404).json({ error: { code: "GOAL_NOT_FOUND", message: "Goal not found.", details: {} } });
        return;
      }
      response.status(200).json(await updateOwnedGoal(
        request.authenticatedUser!.userId,
        request.params.id!,
        request.body,
        repository,
      ));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
