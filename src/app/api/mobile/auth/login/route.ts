import {
  createMobileAuthClient,
  mobileAuthPayload,
} from "@/lib/mobile/auth-session";
import { mobileError, mobileOk, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const email =
      body && typeof body === "object" && "email" in body
        ? String(body.email).trim()
        : "";
    const password =
      body && typeof body === "object" && "password" in body
        ? String(body.password)
        : "";

    if (!email || !password) {
      return mobileError("errors.invalidData");
    }

    const supabase = createMobileAuthClient();
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error || !data.session) {
      return mobileError("errors.unauthorized", 401);
    }

    const payload = await mobileAuthPayload(data.session);
    if (!payload.ok) {
      return mobileError(
        payload.error,
        payload.error === "errors.serverError" ? 500 : 401,
      );
    }

    return mobileOk(payload.data);
  } catch (error) {
    console.error("mobile auth login failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
