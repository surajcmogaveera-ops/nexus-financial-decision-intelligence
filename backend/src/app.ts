import express, { type ErrorRequestHandler } from "express";
import { InputValidationError } from "./financial/schemas.js";
import { financialTwinRouter } from "./financial/routes.js";
import { checkDatabaseConnection } from "./db/prisma.js";
import { scenarioRouter } from "./scenarios/routes.js";
import { createSimulationRouter } from "./simulations/routes.js";
import { SimulationServiceError } from "./simulations/schemas.js";
import { PrismaFinancialDataRepository, type FinancialDataRepository } from "./financial/profileRepository.js";
import { createFinancialTwinReadRouter } from "./financial/routes.js";
import { createGoalsRouter } from "./goals/routes.js";
import { ApiResourceError } from "./api/errors.js";
import { AuthConfigurationError, AuthService, AuthServiceError } from "./auth/service.js";
import { PrismaAuthUserRepository, type AuthUserRepository } from "./auth/repository.js";
import { createAuthRouter } from "./auth/routes.js";
import { AiServiceError } from "./ai/client.js";
import type { AiServiceClient } from "./ai/client.js";
import { PrismaScenarioEvidenceRepository, type ScenarioEvidenceRepository } from "./scenarios/repository.js";
import { createEvidenceRouter } from "./scenarios/evidenceRoutes.js";

export interface AppDependencies {
  databaseHealthCheck?: () => Promise<void>;
  financialDataRepository?: FinancialDataRepository;
  authUserRepository?: AuthUserRepository;
  authService?: AuthService;
  aiServiceClient?: Pick<AiServiceClient, "analyze">;
  scenarioEvidenceRepository?: ScenarioEvidenceRepository;
}

export function assertFrontendOriginConfiguration(
  value = process.env.FRONTEND_ORIGIN,
  environment = process.env.NODE_ENV,
): void {
  if (environment !== "production") return;
  const origins = value?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [];
  if (origins.length === 0) throw new Error("A production frontend origin must be configured.");
  for (const origin of origins) {
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      throw new Error("Production frontend origins must be valid HTTPS origins.");
    }
    if (parsed.protocol !== "https:" || parsed.origin !== origin || origin === "*") {
      throw new Error("Production frontend origins must be valid HTTPS origins.");
    }
  }
}

export function createApp(dependencies: AppDependencies = {}): express.Express {
  const app = express();
  const databaseHealthCheck = dependencies.databaseHealthCheck ?? checkDatabaseConnection;
  const financialDataRepository = dependencies.financialDataRepository ?? new PrismaFinancialDataRepository();
  const auth = dependencies.authService ?? new AuthService(dependencies.authUserRepository ?? new PrismaAuthUserRepository());
  const scenarioEvidenceRepository = dependencies.scenarioEvidenceRepository ?? new PrismaScenarioEvidenceRepository();
  app.use(express.json({ limit: "64kb", strict: true }));
  app.use(createCorsMiddleware());

  app.get("/health", (_request, response) => {
    response.status(200).json({ status: "ok" });
  });
  app.get("/health/db", async (_request, response) => {
    try {
      await databaseHealthCheck();
      response.status(200).json({ status: "ok", database: "ok" });
    } catch {
      response.status(503).json({
        error: {
          code: "DATABASE_UNAVAILABLE",
          message: "Database health check failed.",
          details: {},
        },
      });
    }
  });
  app.use("/api/auth", createAuthRouter(auth));
  app.use("/api/financial-twin", financialTwinRouter);
  app.use("/api/financial-twin", createFinancialTwinReadRouter(financialDataRepository, auth));
  app.use("/api/goals", createGoalsRouter(financialDataRepository, auth));
  app.use("/api/scenarios", scenarioRouter);
  app.use("/api/simulations", createSimulationRouter(dependencies.aiServiceClient, scenarioEvidenceRepository, auth));
  app.use("/api/evidence", createEvidenceRouter(scenarioEvidenceRepository, auth));

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
    if (error instanceof ApiResourceError) {
      response.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
    if (error instanceof AuthServiceError) {
      response.status(error.status).json({
        error: { code: error.code, message: error.message, details: {} },
      });
      return;
    }
    if (error instanceof AiServiceError) {
      response.status(error.status).json({
        error: { code: error.code, message: error.message, details: {} },
      });
      return;
    }
    if (error instanceof AuthConfigurationError) {
      response.status(503).json({
        error: { code: "AUTHENTICATION_UNAVAILABLE", message: "Authentication is not configured.", details: {} },
      });
      return;
    }
    if (error instanceof SimulationServiceError) {
      response.status(error.status).json({
        error: { code: error.code, message: error.message, details: error.details },
      });
      return;
    }
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

function createCorsMiddleware(): express.RequestHandler {
  const origins = new Set(
    (process.env.FRONTEND_ORIGIN ?? "http://localhost:5173")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
  );
  return (request, response, next) => {
    const origin = request.get("origin");
    if (!origin) {
      if (request.method === "OPTIONS") {
        response.sendStatus(204);
        return;
      }
      next();
      return;
    }
    if (!origins.has(origin)) {
      response.status(403).json({
        error: { code: "ORIGIN_NOT_ALLOWED", message: "Request origin is not allowed.", details: {} },
      });
      return;
    }
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Access-Control-Allow-Credentials", "true");
    response.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type");
    response.vary("Origin");
    if (request.method === "OPTIONS") {
      response.sendStatus(204);
      return;
    }
    next();
  };
}
