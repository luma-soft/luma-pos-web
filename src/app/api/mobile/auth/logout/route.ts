import { createMobileAuthClient } from "@/lib/mobile/auth-session";
import { mobileOk, readJson } from "@/lib/mobile/response";
import { authProvider } from "@/lib/auth/provider";
import { revokeAuthSessionForTokens } from "@/lib/auth/lumapos-auth";

export async function POST(request: Request) {
  const body = await readJson(request);
  const accessToken =
    body && typeof body === "object" && "accessToken" in body
      ? String(body.accessToken)
      : "";
  const refreshToken =
    body && typeof body === "object" && "refreshToken" in body
      ? String(body.refreshToken)
      : "";

  if (authProvider() === "lumapos") {
    await revokeAuthSessionForTokens([accessToken, refreshToken]);
    return mobileOk({ signedOut: true });
  }

  if (accessToken && refreshToken) {
    try {
      const supabase = createMobileAuthClient();
      await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      await supabase.auth.signOut();
    } catch (error) {
      console.error("mobile auth logout failed:", error);
    }
  }

  return mobileOk({ signedOut: true });
}
