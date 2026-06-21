import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Session } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";

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
  let profile:
    | {
        fullName: string | null;
        role: string;
        isActive: boolean;
      }
    | undefined;

  try {
    const [{ db }, { profiles }] = await Promise.all([
      import("@/db"),
      import("@/db/schema"),
    ]);

    [profile] = await db
      .select({
        fullName: profiles.fullName,
        role: profiles.role,
        isActive: profiles.isActive,
      })
      .from(profiles)
      .where(eq(profiles.id, session.user.id))
      .limit(1);
  } catch (error) {
    console.error("mobileAuthPayload failed:", error);
    return { ok: false as const, error: "errors.serverError" };
  }

  if (profile && !profile.isActive) {
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
        role: profile?.role ?? "cashier",
        fullName: profile?.fullName ?? session.user.email ?? "",
      },
    },
  };
}
