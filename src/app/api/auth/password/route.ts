import { NextResponse } from "next/server";
import { changeAuthPassword } from "@/lib/auth/lumapos-auth";
import { authProvider, AUTH_SESSION_COOKIE } from "@/lib/auth/provider";
import { clearWebSessionCookie } from "@/lib/auth/session-cookie";
import { getAuthenticatedUser } from "@/lib/auth/store-context";

export async function POST(request: Request) {
  if (authProvider() !== "lumapos") {
    return NextResponse.json({ ok: false, error: "AUTH_PROVIDER_NOT_READY" }, { status: 503 });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "INVALID_DATA" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ ok: false, error: "INVALID_DATA" }, { status: 400 });
  }
  const record = body as Record<string, unknown>;
  const currentPassword = typeof record.currentPassword === "string" ? record.currentPassword : "";
  const newPassword = typeof record.newPassword === "string" ? record.newPassword : "";
  if (!newPassword) return NextResponse.json({ ok: false, error: "INVALID_DATA" }, { status: 400 });

  try {
    const user = await getAuthenticatedUser();
    if (!user) return NextResponse.json({ ok: false, error: "UNAUTHORIZED" }, { status: 401 });
    const changed = await changeAuthPassword({
      profileId: user.id,
      currentPassword,
      newPassword,
    });
    if (!changed) return NextResponse.json({ ok: false, error: "CURRENT_PASSWORD_INVALID" }, { status: 400 });

    const response = NextResponse.json({ ok: true, signedOut: true });
    if (request.headers.get("authorization")?.startsWith("Bearer ")) {
      return response;
    }
    void AUTH_SESSION_COOKIE;
    clearWebSessionCookie(response);
    return response;
  } catch (error) {
    console.error("LumaPOS password change failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return NextResponse.json({ ok: false, error: "SERVER_ERROR" }, { status: 500 });
  }
}
