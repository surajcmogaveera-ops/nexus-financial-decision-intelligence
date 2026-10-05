import type { Response } from "express";
import { AUTH_COOKIE_NAME, AUTH_SESSION_SECONDS } from "./service.js";

export function setAuthenticationCookie(response: Response, token: string, environment = process.env.NODE_ENV): void {
  const parts = [
    `${AUTH_COOKIE_NAME}=${token}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${AUTH_SESSION_SECONDS}`,
  ];
  if (environment === "production") parts.push("Secure");
  response.append("Set-Cookie", parts.join("; "));
}

export function clearAuthenticationCookie(response: Response, environment = process.env.NODE_ENV): void {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Max-Age=0",
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
  ];
  if (environment === "production") parts.push("Secure");
  response.append("Set-Cookie", parts.join("; "));
}

export function readAuthenticationCookie(cookieHeader: string | undefined): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== AUTH_COOKIE_NAME) continue;
    const token = part.slice(separator + 1).trim();
    return token && token.length <= 4096 ? token : null;
  }
  return null;
}

