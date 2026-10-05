import type { Request } from "express";

export interface AuthenticatedUserContext {
  userId: string;
}

export type UserContextResolver = (
  request: Request,
) => AuthenticatedUserContext | null | Promise<AuthenticatedUserContext | null>;

export function createDevelopmentIdentityResolver(
  environment: Record<string, string | undefined> = process.env,
): UserContextResolver {
  return () => {
    const mode = environment.NODE_ENV;
    if (mode !== "development" && mode !== "test") return null;
    const userId = environment.NEXUS_DEV_USER_ID;
    if (!userId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
      return null;
    }
    return { userId };
  };
}

declare global {
  namespace Express {
    interface Request {
      authenticatedUser?: AuthenticatedUserContext;
    }
  }
}
