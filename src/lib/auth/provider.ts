export type AuthProvider = "supabase" | "lumapos";

export function authProvider(): AuthProvider {
  const configured = process.env.LUMAPOS_AUTH_PROVIDER?.trim().toLowerCase();
  if (!configured || configured === "supabase") return "supabase";
  if (configured === "lumapos") return "lumapos";
  throw new Error("LUMAPOS_AUTH_PROVIDER must be 'supabase' or 'lumapos'");
}

export const AUTH_SESSION_COOKIE = "luma_session";
