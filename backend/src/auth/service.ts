import { compare, hash } from "bcryptjs";
import { jwtVerify, SignJWT } from "jose";
import type { AuthenticatedUserContext } from "./context.js";
import type { AuthUser, AuthUserRepository } from "./repository.js";

export const AUTH_COOKIE_NAME = "nexus_session";
export const AUTH_SESSION_SECONDS = 8 * 60 * 60;
const BCRYPT_ROUNDS = 12;
const BCRYPT_MAX_BYTES = 72;
const MIN_PASSWORD_CHARACTERS = 12;
const DUMMY_PASSWORD_HASH = hash("nexus-invalid-login-placeholder", BCRYPT_ROUNDS);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const USER_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export class AuthServiceError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "AuthServiceError";
  }
}

export class AuthConfigurationError extends Error {
  constructor() {
    super("Authentication is not configured.");
    this.name = "AuthConfigurationError";
  }
}

export function assertAuthenticationConfiguration(secret = process.env.AUTH_SECRET): void {
  if (!secret || Buffer.byteLength(secret, "utf8") < 32) throw new AuthConfigurationError();
}

export interface SafeAuthUser {
  id: string;
  email: string;
  name: string | null;
}

export class AuthService {
  private readonly secret: string | undefined;

  constructor(
    private readonly users: AuthUserRepository,
    secret = process.env.AUTH_SECRET,
    private readonly environment = process.env.NODE_ENV,
  ) {
    this.secret = secret;
  }

  assertConfigured(): void {
    assertAuthenticationConfiguration(this.secret);
  }

  async register(input: unknown): Promise<{ user: SafeAuthUser; token: string }> {
    this.assertConfigured();
    const data = parseCredentials(input, true);
    const email = normalizeEmail(data.email);
    if (await this.users.findByEmail(email)) {
      throw new AuthServiceError("EMAIL_ALREADY_EXISTS", "An account with this email already exists.", 409);
    }

    const passwordHash = await hash(data.password, BCRYPT_ROUNDS);
    try {
      const user = await this.users.create({ email, displayName: data.name ?? null, passwordHash });
      return { user: toSafeUser(user), token: await this.createSessionToken(user.id) };
    } catch (error) {
      if (isUniqueEmailError(error)) {
        throw new AuthServiceError("EMAIL_ALREADY_EXISTS", "An account with this email already exists.", 409);
      }
      throw error;
    }
  }

  async login(input: unknown): Promise<{ user: SafeAuthUser; token: string }> {
    this.assertConfigured();
    const data = parseCredentials(input, false);
    const email = normalizeEmail(data.email);
    const user = await this.users.findByEmail(email);
    const passwordHash = user?.passwordHash ?? await DUMMY_PASSWORD_HASH;
    const passwordMatches = await compare(data.password, passwordHash);
    const valid = Boolean(user?.passwordHash && passwordMatches);
    if (!user || !valid) {
      throw new AuthServiceError("AUTHENTICATION_FAILED", "Invalid email or password.", 401);
    }
    return { user: toSafeUser(user), token: await this.createSessionToken(user.id) };
  }

  async createSessionToken(userId: string, now = new Date()): Promise<string> {
    this.assertConfigured();
    if (!USER_ID_PATTERN.test(userId)) throw new Error("Authenticated user identity is invalid.");
    const key = new TextEncoder().encode(this.secret!);
    return new SignJWT({})
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setSubject(userId)
      .setIssuer("nexus-api")
      .setAudience("nexus-web")
      .setIssuedAt(Math.floor(now.getTime() / 1000))
      .setExpirationTime(Math.floor(now.getTime() / 1000) + AUTH_SESSION_SECONDS)
      .sign(key);
  }

  async verifySessionToken(token: string, now = new Date()): Promise<AuthenticatedUserContext | null> {
    try {
      this.assertConfigured();
      const { payload } = await jwtVerify(token, new TextEncoder().encode(this.secret!), {
        algorithms: ["HS256"],
        issuer: "nexus-api",
        audience: "nexus-web",
        currentDate: now,
      });
      if (!payload.sub || !USER_ID_PATTERN.test(payload.sub)) return null;
      return { userId: payload.sub };
    } catch {
      return null;
    }
  }

  async findSafeUser(userId: string): Promise<SafeAuthUser | null> {
    const user = await this.users.findById(userId);
    return user ? toSafeUser(user) : null;
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function parseCredentials(input: unknown, allowName: boolean): { email: string; password: string; name?: string } {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new AuthServiceError("INVALID_REQUEST", "A valid email and password are required.", 400);
  }
  const body = input as Record<string, unknown>;
  const allowedKeys = allowName ? new Set(["email", "password", "name"]) : new Set(["email", "password"]);
  if (Object.keys(body).some((key) => !allowedKeys.has(key))) {
    throw new AuthServiceError("INVALID_REQUEST", "The request contains unsupported fields.", 400);
  }
  if (typeof body.email !== "string" || typeof body.password !== "string") {
    throw new AuthServiceError("INVALID_REQUEST", "A valid email and password are required.", 400);
  }
  const email = normalizeEmail(body.email);
  if (!email || email.length > 320 || !EMAIL_PATTERN.test(email)) {
    throw new AuthServiceError("INVALID_REQUEST", "A valid email and password are required.", 400);
  }
  const passwordBytes = Buffer.byteLength(body.password, "utf8");
  if (body.password.length < MIN_PASSWORD_CHARACTERS || passwordBytes > BCRYPT_MAX_BYTES) {
    throw new AuthServiceError(
      "INVALID_REQUEST",
      `Password must be at least ${MIN_PASSWORD_CHARACTERS} characters and no more than ${BCRYPT_MAX_BYTES} UTF-8 bytes.`,
      400,
    );
  }
  if (body.name !== undefined && (typeof body.name !== "string" || body.name.trim().length > 200)) {
    throw new AuthServiceError("INVALID_REQUEST", "Name must be a string of at most 200 characters.", 400);
  }
  const name = typeof body.name === "string" ? body.name.trim() : undefined;
  return { email, password: body.password, ...(name ? { name } : {}) };
}

function toSafeUser(user: AuthUser): SafeAuthUser {
  return { id: user.id, email: user.email, name: user.displayName };
}

function isUniqueEmailError(error: unknown): boolean {
  const value = error as { code?: string; meta?: { target?: unknown } };
  return value?.code === "P2002" && JSON.stringify(value.meta?.target ?? "email").toLowerCase().includes("email");
}

