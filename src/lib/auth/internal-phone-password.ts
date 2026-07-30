import { or, sql } from "drizzle-orm";
import type { Session } from "@supabase/supabase-js";
import { db } from "@/db";
import { profiles } from "@/db/schema";
import { createMobileAuthClient } from "@/lib/mobile/auth-session";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

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

  const phoneKeys = lookupPhoneKeys(normalizedPhone);
  const phoneDigits = sql<string>`regexp_replace(coalesce(${profiles.phone}, ''), '[^0-9]', '', 'g')`;
  const matches = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(or(...phoneKeys.map((key) => sql`${phoneDigits} = ${key}`)))
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

export function normalizePhone(value: string) {
  const compact = value.trim().replace(/[\s().-]/g, "");
  if (/^0\d{9,10}$/.test(compact)) return `+84${compact.slice(1)}`;
  if (/^84\d{9,10}$/.test(compact)) return `+${compact}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}

function lookupPhoneKeys(normalizedPhone: string) {
  const international = normalizedPhone.slice(1);
  return international.startsWith("84")
    ? [international, `0${international.slice(2)}`]
    : [international];
}
