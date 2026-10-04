import { Router } from "express";
import { calculateFinancialTwin } from "./service.js";
import { parseFinancialTwinRequest } from "./schemas.js";

export const financialTwinRouter = Router();

financialTwinRouter.post("/recalculate", (request, response, next) => {
  try {
    const parsed = parseFinancialTwinRequest(request.body);
    response.status(200).json(calculateFinancialTwin(parsed));
  } catch (error) {
    next(error);
  }
});
