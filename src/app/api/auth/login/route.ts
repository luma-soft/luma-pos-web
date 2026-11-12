import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseCookieClient } from "@/lib/supabase/server";
import { signInWithInternalPhonePassword } from "@/lib/auth/internal-phone-password";
import { authenticatePassword, createWebAuthSession } from "@/lib/auth/lumapos-auth";
import { authProvider } from "@/lib/auth/provider";
import { setWebSessionCookie } from "@/lib/auth/session-cookie";
import { mobileError, readJson } from "@/lib/mobile/response";

export async function POST(request: NextRequest) {
  try {
    const body = await readJson(request);
    const email = body && typeof body === "object" && "email" in body
      ? String(body.email).trim().toLowerCase()
      : "";
    const phone = body && typeof body === "object" && "phone" in body
      ? String(body.phone)
      : "";
    const password = body && typeof body === "object" && "password" in body
      ? String(body.password)
      : "";
    if ((!email && !phone) || !password || (email && phone)) {
      return mobileError("errors.invalidData");
    }

    if (authProvider() === "lumapos") {
      const user = await authenticatePassword({ email: email || null, phone: phone || null, password });
      if (!user) return mobileError("errors.unauthorized", 401);
      const session = await createWebAuthSession(user.id);
      if (!session) return mobileError("errors.unauthorized", 401);
      const response = NextResponse.json({ ok: true });
      setWebSessionCookie(response, session.token, session.expiresAt);
      return response;
    }

    const supabase = await createSupabaseCookieClient();
    if (email) {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) return mobileError("errors.unauthorized", 401);
    } else {
      const session = await signInWithInternalPhonePassword({ phone, password });
      if (!session) return mobileError("errors.unauthorized", 401);
      const { error } = await supabase.auth.setSession({
        access_token: session.access_token,
        refresh_token: session.refresh_token,
      });
      if (error) return mobileError("errors.unauthorized", 401);
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("web auth login failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return mobileError("errors.serverError", 500);
  }
}
