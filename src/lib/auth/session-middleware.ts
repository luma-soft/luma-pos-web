import { NextResponse, type NextRequest } from "next/server";
import type { LumaAuthenticatedUser } from "@backend/lib/auth/lumapos-auth";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { AUTH_SESSION_COOKIE } from "@/lib/auth/provider";
import { requestBackend } from "@/lib/backend/rpc";

const CACHE_MS = 30_000;
const CACHE_LIMIT = 500;
const sessions = new Map<string, { user: LumaAuthenticatedUser | null; at: number }>();

/**
 * The signed-in user for a session cookie, asked from the backend and kept
 * for 30 seconds so page navigation does not query it on every request.
 * Signing out deletes the session in the backend; a cached answer here only
 * decides between the page and the login screen, and every page and action
 * checks the session again in the backend.
 */
async function sessionUser(token: string, request: NextRequest): Promise<LumaAuthenticatedUser | null> {
  const now = Date.now();
  const cached = sessions.get(token);
  if (cached && now - cached.at < CACHE_MS) return cached.user;
  const { reply } = await requestBackend("lib/auth/web-session-check.ts#getWebSessionUser", [token], request.headers);
  const user = reply.status === "ok" ? (reply.value as LumaAuthenticatedUser | null) : null;
  sessions.delete(token);
  sessions.set(token, { user, at: now });
  if (sessions.size > CACHE_LIMIT) sessions.delete(sessions.keys().next().value!);
  return user;
}

export async function updateLumaSession(request: NextRequest) {
  const path = request.nextUrl.pathname;
  // Backend-only endpoint: only this server calls it, with the proxy secret.
  if (path.startsWith("/api/web/")) return new NextResponse("Not Found", { status: 404 });

  const token = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
  const isAuthPath = path.startsWith(Routes.Login) || path.startsWith(Routes.Register);
  const isApiPath = path.startsWith("/api");
  const isPortalPath = path.startsWith("/portal");
  const isPublic =
    isAuthPath ||
    isApiPath ||
    isPortalPath ||
    path === Routes.Home ||
    path === Routes.CameraQuote ||
    path.startsWith(`${Routes.CameraQuote}/`) ||
    path === "/camera-price-list" ||
    path === "/privacy" ||
    path === "/support" ||
    path === Routes.HunonicPriceList ||
    path === Routes.RangDongSmartPriceList;
  // API requests go to the backend, which checks the session itself.
  if (isApiPath) return NextResponse.next({ request });

  const user = token ? await sessionUser(token, request) : null;

  if (!user && !isPublic) {
    const url = request.nextUrl.clone();
    url.pathname = Routes.Login;
    return NextResponse.redirect(url);
  }

  if (user && isAuthPath) {
    const url = request.nextUrl.clone();
    if (ONLINE_SALES_ENABLED && user.email?.toLowerCase() === "review@lumapos.shop") {
      url.pathname = Routes.OnlineSales;
      url.searchParams.set("tab", "overview");
      url.searchParams.set("channel", "shopee");
    } else {
      url.pathname = Routes.Dashboard;
    }
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request });
}
