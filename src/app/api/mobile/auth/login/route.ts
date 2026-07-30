import {
  createMobileAuthClient,
  mobileAuthPayload,
} from "@/lib/mobile/auth-session";
import { mobileError, mobileOk, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const email = body && typeof body === "object" && "email" in body
      ? String(body.email).trim().toLowerCase()
      : "";
    const phone = body && typeof body === "object" && "phone" in body
      ? normalizePhone(String(body.phone))
      : null;
    const password =
      body && typeof body === "object" && "password" in body
        ? String(body.password)
        : "";

    if ((!email && !phone) || !password) {
      return mobileError("errors.invalidData");
    }

    const supabase = createMobileAuthClient();
    const { data, error } = await supabase.auth.signInWithPassword(
      phone ? { phone, password } : { email, password },
    );

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

function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (/^0\d{9,10}$/.test(compact)) return `+84${compact.slice(1)}`;
  if (/^84\d{9,10}$/.test(compact)) return `+${compact}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}
