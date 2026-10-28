import {
  createMobileAuthClient,
  mobileAuthPayload,
} from "@/lib/mobile/auth-session";
import { signInWithInternalPhonePassword } from "@/lib/auth/internal-phone-password";
import { mobileError, mobileOk, readJson } from "@/lib/mobile/response";

function safeErrorCode(error: unknown): string | undefined {
  let current = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return undefined;
    const record = current as { code?: unknown; cause?: unknown };
    if (typeof record.code === "string") return record.code;
    current = record.cause;
  }
  return undefined;
}

export async function POST(request: Request) {
  try {
    const body = await readJson(request);
    const email = body && typeof body === "object" && "email" in body
      ? String(body.email).trim().toLowerCase()
      : "";
    const phone = body && typeof body === "object" && "phone" in body
      ? String(body.phone)
      : null;
    const password =
      body && typeof body === "object" && "password" in body
        ? String(body.password)
        : "";

    if ((!email && !phone) || !password) {
      return mobileError("errors.invalidData");
    }

    const session = phone
      ? await signInWithInternalPhonePassword({ phone, password })
      : (await createMobileAuthClient().auth.signInWithPassword({ email, password })).data.session;

    if (!session) {
      return mobileError("errors.unauthorized", 401);
    }

    const payload = await mobileAuthPayload(session);
    if (!payload.ok) {
      return mobileError(
        payload.error,
        payload.error === "errors.serverError" ? 500 : 401,
      );
    }

    return mobileOk(payload.data);
  } catch (error) {
    // Avoid logging the full Drizzle/Postgres error: it includes the submitted
    // phone number in query parameters. Keep only non-sensitive diagnostics.
    console.error("mobile auth login failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
      code: safeErrorCode(error),
    });
    return mobileError("errors.serverError", 500);
  }
}
