import type { RequestHandler } from "express";
import { readAuthenticationCookie } from "./cookies.js";
import type { AuthService } from "./service.js";

export function createAuthenticationMiddleware(auth: AuthService): RequestHandler {
  return (request, response, next) => {
    const token = readAuthenticationCookie(request.headers.cookie);
    if (!token) {
      response.status(401).json({
        error: { code: "AUTHENTICATION_REQUIRED", message: "Authentication is required.", details: {} },
      });
      return;
    }

    void auth.verifySessionToken(token).then((context) => {
      if (!context) {
        response.status(401).json({
          error: { code: "UNAUTHORIZED", message: "Authentication is invalid or expired.", details: {} },
        });
        return;
      }
      request.auth = context;
      next();
    }).catch(next);
  };
}

/** Resolves a valid session when present while preserving anonymous access for public routes. */
export function createOptionalAuthenticationMiddleware(auth: AuthService): RequestHandler {
  return (request, response, next) => {
    const token = readAuthenticationCookie(request.headers.cookie);
    if (!token) { next(); return; }
    void auth.verifySessionToken(token).then((context) => {
      if (!context) {
        response.status(401).json({ error: { code: "UNAUTHORIZED", message: "Authentication is invalid or expired.", details: {} } });
        return;
      }
      request.auth = context;
      next();
    }).catch(next);
  };
}
