import { Router } from "express";
import { AiServiceClient } from "../ai/client.js";
import { simulateWithAi } from "./service.js";

export function createSimulationRouter(aiServiceClient: Pick<AiServiceClient, "analyze"> = new AiServiceClient()) {
  const simulationRouter = Router();

  simulationRouter.post("/", async (request, response, next) => {
    try {
      response.status(200).json(await simulateWithAi(request.body, aiServiceClient));
    } catch (error) {
      next(error);
    }
  });

  return simulationRouter;
}

