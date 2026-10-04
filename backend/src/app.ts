import express, { type ErrorRequestHandler } from "express";
import { InputValidationError } from "./financial/schemas.js";
import { financialTwinRouter } from "./financial/routes.js";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json({ limit: "64kb", strict: true }));

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.use("/api/financial-twin", financialTwinRouter);

  app.use("/api", (request, response) => {
    response.status(404).json({
      error: {
        code: "NOT_IMPLEMENTED",
        message: "This API endpoint is not implemented yet.",
        details: { path: request.path, method: request.method },
      },
    });
  });
  app.use((_request, response) => {
    response.status(404).json({
      error: { code: "NOT_FOUND", message: "Resource not found.", details: {} },
    });
  });

  const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, _next) => {
    if (error instanceof InputValidationError) {
      response.status(400).json({
        error: {
          code: "VALIDATION_ERROR",
          message: error.message,
          details: error.details,
        },
      });
      return;
    }

    const parseError = error as { type?: string };
    if (parseError?.type === "entity.parse.failed") {
      response.status(400).json({
        error: {
          code: "INVALID_JSON",
          message: "Request body must contain valid JSON.",
          details: {},
        },
      });
      return;
    }

    response.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "An internal server error occurred.",
        details: {},
      },
    });
  };
  app.use(errorHandler);
  return app;
}
