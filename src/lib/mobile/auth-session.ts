import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";

export function createMobileAuthClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    },
  );
}

export async function mobileAuthPayload(session: Session) {
  let context;
  try {
    context = await resolveStoreContextForUser(session.user.id);
  } catch (error) {
    console.error("mobileAuthPayload failed:", error);
    return { ok: false as const, error: "errors.serverError" };
  }

  if (!context) {
    return { ok: false as const, error: "errors.unauthorized" };
  }

  return {
    ok: true as const,
    data: {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt:
        (session.expires_at ??
          Math.floor(Date.now() / 1000) + session.expires_in) * 1000,
      user: {
        id: session.user.id,
        email: session.user.email ?? "",
        role: context.role,
        fullName: context.fullName,
      },
      store: {
        id: context.storeId,
        name: context.storeName,
        slug: context.storeSlug,
        features: context.features,
      },
    },
  };
}
