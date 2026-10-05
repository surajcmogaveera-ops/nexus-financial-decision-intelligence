import type { RequestHandler } from "express";
import type { UserContextResolver } from "./context.js";

export function createUserContextMiddleware(resolver: UserContextResolver): RequestHandler {
  return (request, response, next) => {
    Promise.resolve(resolver(request)).then((context) => {
      if (!context?.userId) {
        response.status(401).json({
          error: {
            code: "AUTHENTICATION_REQUIRED",
            message: "A trusted user context is required.",
            details: {},
          },
        });
        return;
      }
      request.authenticatedUser = context;
      next();
    }).catch(next);
  };
}
