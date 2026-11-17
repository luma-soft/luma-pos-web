import type { NextResponse } from "next/server";
import { AUTH_SESSION_COOKIE } from "@/lib/auth/provider";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

/**
 * The store Mac opens the web app directly at http://127.0.0.1:3000. A
 * `Secure` cookie is not stored over plain http there (Safari), so drop the
 * flag only for a direct loopback request. Requests through the Cloudflare
 * Tunnel carry the public host and `x-forwarded-proto: https` and keep it.
 */
export function isDirectLoopbackHttpRequest(request: Request): boolean {
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https") return false;
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return LOOPBACK_HOSTS.has(hostname.toLowerCase());
}

function secureCookie(request?: Request): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return !(request && isDirectLoopbackHttpRequest(request));
}

export function setWebSessionCookie(
  response: NextResponse,
  token: string,
  expiresAt: number,
  request?: Request,
) {
  response.cookies.set(AUTH_SESSION_COOKIE, token, {
    httpOnly: true,
    secure: secureCookie(request),
    sameSite: "lax",
    path: "/",
    expires: new Date(expiresAt),
    maxAge: Math.max(0, Math.floor((expiresAt - Date.now()) / 1_000)),
  });
}

export function clearWebSessionCookie(response: NextResponse, request?: Request) {
  response.cookies.set(AUTH_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: secureCookie(request),
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
    maxAge: 0,
  });
}
