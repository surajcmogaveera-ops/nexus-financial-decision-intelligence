import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { assertFrontendOriginConfiguration, createApp } from "../dist/app.js";
import { AuthService, normalizeEmail } from "../dist/auth/service.js";
import { assertAuthenticationConfiguration } from "../dist/auth/service.js";
import { InMemoryAuthUserRepository } from "./helpers/in-memory-auth-repository.mjs";
import { InMemoryFinancialDataRepository, makeProfile } from "./helpers/in-memory-financial-repository.mjs";

const TEST_SECRET = "hour-nine-test-secret-never-use-in-production-1234";
const authUsers = new InMemoryAuthUserRepository();
const financialData = new InMemoryFinancialDataRepository();
const authService = new AuthService(authUsers, TEST_SECRET, "test");
const server = createApp({ authUserRepository: authUsers, financialDataRepository: financialData, authService });
let baseUrl;

before(async () => {
  const listener = server.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    listener.once("listening", resolve);
    listener.once("error", reject);
  });
  server.listener = listener;
  baseUrl = `http://127.0.0.1:${listener.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => server.listener.close((error) => error ? reject(error) : resolve()));
  financialData.clear();
});

function send(path, { cookie, ...options } = {}) {
  const headers = new Headers(options.headers ?? {});
  if (cookie) headers.set("cookie", cookie);
  return fetch(`${baseUrl}${path}`, { ...options, headers });
}

function requestCookie(response) {
  const header = response.headers.get("set-cookie") ?? "";
  return header.split(";")[0];
}

function authBody(password = "correct-horse-battery-7") {
  return { email: " Person@Example.com ", password };
}

test("registration normalizes email, hashes passwords, returns safe user data, and rejects duplicates", async () => {
  const response = await send("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...authBody(), name: "Nexus User" }),
  });
  assert.equal(response.status, 201);
  assert.match(response.headers.get("set-cookie"), /HttpOnly/);
  assert.match(response.headers.get("set-cookie"), /SameSite=Lax/);
  const result = await response.json();
  assert.deepEqual(result.user, { id: result.user.id, email: "person@example.com", name: "Nexus User" });
  assert.equal("password" in result, false);
  assert.equal("passwordHash" in result, false);
  const stored = await authUsers.findById(result.user.id);
  assert.match(stored.passwordHash, /^\$2[aby]\$12\$/);
  assert.notEqual(stored.passwordHash, "correct-horse-battery-7");
  const duplicate = await send("/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(authBody()),
  });
  assert.equal(duplicate.status, 409);
  assert.equal((await duplicate.json()).error.code, "EMAIL_ALREADY_EXISTS");
  assert.equal(authUsers.usersById.size, 1);
});

test("login and /me use the signed HttpOnly cookie and expose no token or hash", async () => {
  const login = await send("/api/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "PERSON@example.COM", password: "correct-horse-battery-7" }),
  });
  assert.equal(login.status, 200);
  const cookie = requestCookie(login);
  assert.ok(cookie.startsWith("nexus_session="));
  const loginBody = await login.json();
  assert.deepEqual(loginBody.user, { id: loginBody.user.id, email: "person@example.com", name: "Nexus User" });
  assert.equal(JSON.stringify(loginBody).includes("passwordHash"), false);
  assert.equal(JSON.stringify(loginBody).includes("eyJ"), false);

  const me = await send("/api/auth/me", { cookie });
  assert.equal(me.status, 200);
  assert.deepEqual(await me.json(), { user: loginBody.user });
  assert.equal((await send("/api/auth/me")).status, 401);
});

test("login failure is generic and registration input is validated", async () => {
  const wrongPassword = await send("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", password: "incorrect-password" }),
  });
  const wrongEmail = await send("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "missing@example.com", password: "incorrect-password" }),
  });
  assert.equal(wrongPassword.status, 401);
  assert.equal(wrongEmail.status, 401);
  const wrongPasswordBody = await wrongPassword.json();
  assert.deepEqual(wrongPasswordBody, await wrongEmail.json());
  assert.equal(wrongPasswordBody.error.message, "Invalid email or password.");

  for (const body of [
    { email: "not-an-email", password: "correct-horse-battery-7" },
    { email: "valid@example.com", password: "short" },
    { email: "valid@example.com", password: "a".repeat(73) },
    { email: "valid@example.com", password: "correct-horse-battery-7", userId: "attacker" },
  ]) {
    const response = await send("/api/auth/register", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    assert.equal(response.status, 400);
    assert.equal((await response.json()).error.code, "INVALID_REQUEST");
  }
});

test("protected Financial Twin and Goals use authenticated identity, and ignore client ownership claims", async () => {
  const login = await send("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", password: "correct-horse-battery-7" }),
  });
  const cookie = requestCookie(login);
  const { user } = await login.json();
  financialData.profiles.set(user.id, makeProfile({ userId: user.id }));

  const unauthTwin = await send("/api/financial-twin");
  const unauthGoals = await send("/api/goals");
  assert.equal(unauthTwin.status, 401);
  assert.equal(unauthGoals.status, 401);

  const twin = await send(`/api/financial-twin?userId=${encodeURIComponent("22222222-2222-4222-8222-222222222222")}`, {
    cookie, headers: { "x-test-user": "22222222-2222-4222-8222-222222222222" },
  });
  assert.equal(twin.status, 200);
  assert.equal((await twin.json()).raw.monthlyIncome, "30000");
  const goals = await send("/api/goals", { cookie });
  assert.equal(goals.status, 200);
  assert.deepEqual(await goals.json(), []);
});

test("logout clears the cookie and the previous session no longer authenticates through that cookie", async () => {
  const login = await send("/api/auth/login", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "person@example.com", password: "correct-horse-battery-7" }),
  });
  const cookie = requestCookie(login);
  const logout = await send("/api/auth/logout", { method: "POST", cookie });
  assert.equal(logout.status, 200);
  assert.equal((await logout.json()).status, "ok");
  assert.match(logout.headers.get("set-cookie"), /Max-Age=0/);
  assert.equal((await send("/api/auth/me", { cookie: requestCookie(logout) })).status, 401);
});

test("malformed and expired sessions fail safely, and auth secrets are required", async () => {
  assert.equal((await send("/api/auth/me", { cookie: "nexus_session=not-a-token" })).status, 401);
  const user = await authUsers.findByEmail("person@example.com");
  const expired = await authService.createSessionToken(user.id, new Date(Date.now() - 9 * 60 * 60 * 1000));
  const expiredResponse = await send("/api/auth/me", { cookie: `nexus_session=${expired}` });
  assert.equal(expiredResponse.status, 401);
  assert.equal(JSON.stringify(await expiredResponse.json()).includes(TEST_SECRET), false);
  assert.throws(() => assertAuthenticationConfiguration("too-short"), /Authentication is not configured/);
  assert.equal(normalizeEmail(" User@Example.com "), "user@example.com");
});

test("credentialed CORS uses a configured explicit origin and rejects unlisted origins", async () => {
  const allowed = await send("/health", { headers: { origin: "http://localhost:5173" } });
  assert.equal(allowed.status, 200);
  assert.equal(allowed.headers.get("access-control-allow-origin"), "http://localhost:5173");
  assert.equal(allowed.headers.get("access-control-allow-credentials"), "true");
  const denied = await send("/health", { headers: { origin: "https://untrusted.example" } });
  assert.equal(denied.status, 403);
  assert.equal(denied.headers.get("access-control-allow-origin"), null);
  assert.throws(() => assertFrontendOriginConfiguration(undefined, "production"));
  assert.throws(() => assertFrontendOriginConfiguration("http://localhost:5173", "production"));
  assert.doesNotThrow(() => assertFrontendOriginConfiguration("https://app.example.com", "production"));
});
