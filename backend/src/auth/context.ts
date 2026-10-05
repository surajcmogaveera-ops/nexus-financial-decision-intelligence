export interface AuthenticatedUserContext {
  userId: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUserContext;
    }
  }
}
