import "server-only";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { notFound, redirect, permanentRedirect, RedirectType } from "next/navigation";
import { UnauthorizedError } from "@backend/lib/auth/unauthorized-error";
import {
  decodeRpc,
  encodeRpc,
  WEB_RPC_PATH,
  WEB_RPC_SECRET_HEADER,
  type RpcResponse,
} from "@backend/lib/web-rpc/codec";

/** The backend service on this Mac (luma-pos-backend), by default 127.0.0.1:3001. */
export function backendOrigin(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.LUMAPOS_BACKEND_URL?.trim();
  if (configured) return configured.replace(/\/+$/, "");
  return `http://127.0.0.1:${env.LUMAPOS_BACKEND_PORT?.trim() || "3001"}`;
}

const FORWARDED_HEADERS = ["cookie", "user-agent", "accept-language", "x-forwarded-for", "x-real-ip"] as const;
const CALL_TIMEOUT_MS = 10 * 60_000;

/**
 * Headers for a call made on behalf of the browser request: its cookies, and
 * the host and scheme it used (the backend decides cookie flags and public
 * links from them).
 */
export function backendRequestHeaders(incoming: Headers, env: NodeJS.ProcessEnv = process.env): Headers {
  const outgoing = new Headers({ "content-type": "application/json" });
  for (const name of FORWARDED_HEADERS) {
    const value = incoming.get(name);
    if (value) outgoing.set(name, value);
  }
  const host = incoming.get("x-forwarded-host")?.split(",")[0]?.trim() || incoming.get("host");
  if (host) outgoing.set("x-forwarded-host", host);
  const proto = incoming.get("x-forwarded-proto")?.split(",")[0]?.trim();
  outgoing.set("x-forwarded-proto", proto || "http");
  outgoing.set(WEB_RPC_SECRET_HEADER, env.LUMAPOS_WEB_PROXY_SECRET?.trim() ?? "");
  return outgoing;
}

export class BackendUnavailableError extends Error {
  constructor(detail: string) {
    super(`BACKEND_UNAVAILABLE: ${detail}`);
    this.name = "BackendUnavailableError";
  }
}

/** One call to /api/web/rpc; the caller handles the reply. */
export async function requestBackend(fn: string, args: unknown[], incoming: Headers): Promise<{ reply: RpcResponse; setCookies: string[] }> {
  let response: Response;
  try {
    response = await fetch(`${backendOrigin()}${WEB_RPC_PATH}`, {
      method: "POST",
      headers: backendRequestHeaders(incoming),
      body: encodeRpc({ fn, args }),
      cache: "no-store",
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (error) {
    throw new BackendUnavailableError(error instanceof Error ? error.message : String(error));
  }
  if (!response.ok) throw new BackendUnavailableError(`${fn}: HTTP ${response.status}`);
  return { reply: decodeRpc<RpcResponse>(await response.text()), setCookies: response.headers.getSetCookie() };
}

type CookieOptions = NonNullable<Parameters<Awaited<ReturnType<typeof cookies>>["set"]>[2]>;

/** "name=value; Path=/; HttpOnly; …" → cookies().set arguments. */
export function parseSetCookie(header: string): { name: string; value: string; options: CookieOptions } | null {
  const [pair, ...attributes] = header.split(";");
  const separator = pair.indexOf("=");
  if (separator <= 0) return null;
  const name = pair.slice(0, separator).trim();
  const value = decodeURIComponent(pair.slice(separator + 1).trim());
  const options: CookieOptions = {};
  for (const attribute of attributes) {
    const [rawKey, ...rest] = attribute.split("=");
    const key = rawKey.trim().toLowerCase();
    const attributeValue = rest.join("=").trim();
    if (key === "path") options.path = attributeValue;
    else if (key === "domain") options.domain = attributeValue;
    else if (key === "expires") options.expires = new Date(attributeValue);
    else if (key === "max-age") options.maxAge = Number(attributeValue);
    else if (key === "httponly") options.httpOnly = true;
    else if (key === "secure") options.secure = true;
    else if (key === "samesite") options.sameSite = attributeValue.toLowerCase() as CookieOptions["sameSite"];
  }
  return { name, value, options };
}

/**
 * Calls a backend function as the signed-in browser user (generated proxies in
 * src/lib/actions, src/lib/data, … use this). Cookies the backend sets and the
 * pages it revalidates are applied here; redirect(), notFound() and
 * UnauthorizedError behave as if the function ran in this process.
 */
export async function callBackend<T>(fn: string, args: unknown[]): Promise<T> {
  const { reply, setCookies } = await requestBackend(fn, args, await headers());

  if (setCookies.length) {
    const store = await cookies();
    for (const header of setCookies) {
      const cookie = parseSetCookie(header);
      // Setting cookies works in server actions and route handlers; during a
      // page render Next refuses it, which matches what the call could do
      // in-process.
      if (cookie) try { store.set(cookie.name, cookie.value, cookie.options); } catch { /* render */ }
    }
  }
  for (const entry of reply.revalidate) {
    try { revalidatePath(entry.path, entry.type); } catch { /* render */ }
  }

  switch (reply.status) {
    case "ok":
      return reply.value as T;
    case "redirect":
      if (reply.permanent) permanentRedirect(reply.url, reply.type === "push" ? RedirectType.push : RedirectType.replace);
      redirect(reply.url, reply.type === "push" ? RedirectType.push : RedirectType.replace);
    case "notFound":
      notFound();
    case "error": {
      if (reply.name === "UnauthorizedError") throw new UnauthorizedError();
      const error = new Error(reply.message);
      error.name = reply.name;
      throw error;
    }
  }
}
