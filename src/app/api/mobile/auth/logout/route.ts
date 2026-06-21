import { createMobileAuthClient } from "@/lib/mobile/auth-session";
import { mobileOk, readJson } from "@/lib/mobile/response";

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
