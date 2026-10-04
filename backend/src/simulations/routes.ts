import { Router } from "express";
import { simulate } from "./service.js";

export const simulationRouter = Router();

simulationRouter.post("/", (request, response, next) => {
  try {
    response.status(200).json(simulate(request.body));
  } catch (error) {
    next(error);
  }
});

