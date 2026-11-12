import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "./lib/supabase/middleware";
import { authProvider } from "./lib/auth/provider";
import { updateLumaSession } from "./lib/auth/session-middleware";

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  if (path === "/api/health/live" || path === "/api/health/ready") {
    return NextResponse.next({ request });
  }

  if (process.env.LUMAPOS_MAINTENANCE_MODE === "true") {
    const method = request.method.toUpperCase();
    const scheduledOrWorkerRoute = path.startsWith("/api/cron/") || path.startsWith("/api/workers/");
    if (scheduledOrWorkerRoute || !["GET", "HEAD", "OPTIONS"].includes(method)) {
      return NextResponse.json(
        { ok: false, error: "MAINTENANCE_MODE" },
        { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "60" } },
      );
    }
  }

  if (authProvider() === "lumapos") {
    return await updateLumaSession(request);
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|sw\\.js|manifest\\.webmanifest|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
