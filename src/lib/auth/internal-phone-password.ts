import { eq } from "drizzle-orm";
import type { Session } from "@supabase/supabase-js";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { createMobileAuthClient } from "@/lib/mobile/auth-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { normalizePhone } from "@/lib/auth/phone";

export { normalizePhone } from "@/lib/auth/phone";

/**
 * Signs in an existing email/password account using the staff phone stored in
 * `profiles`. This deliberately does not use Supabase Phone Auth or send SMS.
 */
export async function signInWithInternalPhonePassword(input: {
  phone: string;
  password: string;
}): Promise<Session | null> {
  const normalizedPhone = normalizePhone(input.phone);
  if (!normalizedPhone) return null;

  const matches = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.phoneNormalized, normalizedPhone))
    .limit(2);

  // A phone number must identify exactly one staff account. Failing closed
  // prevents ambiguous or duplicated profile phone values from being usable.
  if (matches.length !== 1) return null;

  const admin = createSupabaseAdminClient();
  const { data: userData, error: userError } = await admin.auth.admin.getUserById(matches[0].id);
  if (userError || !userData.user?.email) return null;

  const auth = createMobileAuthClient();
  const { data, error } = await auth.auth.signInWithPassword({
    email: userData.user.email,
    password: input.password,
  });
  return error ? null : data.session;
}
