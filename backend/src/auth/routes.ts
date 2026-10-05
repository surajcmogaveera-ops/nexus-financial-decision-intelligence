import { Router } from "express";
import { clearAuthenticationCookie, setAuthenticationCookie } from "./cookies.js";
import { createAuthenticationMiddleware } from "./middleware.js";
import { AuthService, AuthServiceError } from "./service.js";

export function createAuthRouter(auth: AuthService, environment = process.env.NODE_ENV) {
  const router = Router();
  const requireAuthentication = createAuthenticationMiddleware(auth);

  router.post("/register", async (request, response, next) => {
    try {
      const result = await auth.register(request.body);
      setAuthenticationCookie(response, result.token, environment);
      response.status(201).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/login", async (request, response, next) => {
    try {
      const result = await auth.login(request.body);
      setAuthenticationCookie(response, result.token, environment);
      response.status(200).json({ user: result.user });
    } catch (error) {
      next(error);
    }
  });

  router.post("/logout", (_request, response) => {
    clearAuthenticationCookie(response, environment);
    response.status(200).json({ status: "ok" });
  });

  router.get("/me", requireAuthentication, async (request, response, next) => {
    try {
      const user = await auth.findSafeUser(request.auth!.userId);
      if (!user) {
        next(new AuthServiceError("UNAUTHORIZED", "Authentication is invalid or expired.", 401));
        return;
      }
      response.status(200).json({ user });
    } catch (error) {
      next(error);
    }
  });

  return router;
}

