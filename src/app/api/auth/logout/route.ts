import { NextResponse, type NextRequest } from "next/server";
import { createClient as createSupabaseCookieClient } from "@/lib/supabase/server";
import { revokeAuthSessionForTokens } from "@/lib/auth/lumapos-auth";
import { authProvider, AUTH_SESSION_COOKIE } from "@/lib/auth/provider";
import { clearWebSessionCookie } from "@/lib/auth/session-cookie";

export async function POST(request: NextRequest) {
  if (authProvider() === "lumapos") {
    const token = request.cookies.get(AUTH_SESSION_COOKIE)?.value;
    if (token) await revokeAuthSessionForTokens([token]);
    const response = NextResponse.json({ ok: true, signedOut: true });
    clearWebSessionCookie(response);
    return response;
  }

  try {
    const supabase = await createSupabaseCookieClient();
    await supabase.auth.signOut();
  } catch {
    // Clear the browser state even if the legacy provider is temporarily down.
  }
  return NextResponse.json({ ok: true, signedOut: true });
}
