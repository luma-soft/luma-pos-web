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

function requestHostname(request: Request): string {
  const host = request.headers.get("host") ?? new URL(request.url).host;
  const hostname = host.startsWith("[") ? host.slice(0, host.indexOf("]") + 1) : host.split(":")[0];
  return hostname.toLowerCase();
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [first, second] = parts.map(Number);
  return first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168);
}

/**
 * LAN mode (`LUMAPOS_LAN_HTTP=true`, set by `lumapos-admin set-network lan`):
 * other devices in the store open http://<mac>.local:3000 or the Mac's
 * private IPv4 address, where a `Secure` cookie would not be stored. Only
 * such plain-http requests drop the flag; the Cloudflare hostname keeps it.
 */
export function isLanHttpRequest(request: Request, env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.LUMAPOS_LAN_HTTP?.trim().toLowerCase() !== "true") return false;
  const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwardedProto === "https") return false;
  const hostname = requestHostname(request);
  return /^[a-z0-9-]+\.local$/.test(hostname) || isPrivateIpv4(hostname);
}

function secureCookie(request?: Request): boolean {
  if (process.env.NODE_ENV !== "production") return false;
  return !(request && (isDirectLoopbackHttpRequest(request) || isLanHttpRequest(request)));
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
