import { Router } from "express";
import { calculateFinancialTwin } from "./service.js";
import { parseFinancialTwinRequest } from "./schemas.js";
import { createFinancialProfileRouter } from "./profileRoutes.js";
import type { UserContextResolver } from "../auth/context.js";
import type { FinancialDataRepository } from "./profileRepository.js";

export const financialTwinRouter = Router();

financialTwinRouter.post("/recalculate", (request, response, next) => {
  try {
    const parsed = parseFinancialTwinRequest(request.body);
    response.status(200).json(calculateFinancialTwin(parsed));
  } catch (error) {
    next(error);
  }
});

export function createFinancialTwinReadRouter(
  repository: FinancialDataRepository,
  resolveUserContext: UserContextResolver,
) {
  return createFinancialProfileRouter(repository, resolveUserContext);
}
