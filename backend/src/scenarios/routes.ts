import { Router } from "express";
import { executeSimulation } from "../simulations/service.js";

export const scenarioRouter = Router();

scenarioRouter.post("/simulate", (request, response, next) => {
  try {
    response.status(200).json(executeSimulation(request.body, "profile"));
  } catch (error) {
    next(error);
  }
});
