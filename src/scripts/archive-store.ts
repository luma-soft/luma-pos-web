/** Recoverable archive/restore for disposable rollout stores. */
import { createClient } from "@supabase/supabase-js";
import postgres from "postgres";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}
const slug = argument("slug");
const restore = process.argv.includes("--restore");
if (!slug?.startsWith("codex-isolation-")) throw new Error("Only codex-isolation-* disposable stores may be archived");
const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!databaseUrl || !supabaseUrl || !serviceRoleKey) throw new Error("Missing operations credentials");
const sql = postgres(databaseUrl, { max: 1, prepare: false });
const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const [store] = await sql<{ id: string }[]>`select id from public.stores where slug = ${slug} limit 1`;
if (!store) throw new Error("Disposable store not found");
const owners = await sql<{ id: string }[]>`select id from public.profiles where store_id = ${store.id}::uuid and role = 'owner'`;
await sql.begin(async (tx) => {
  await tx`update public.stores set status = ${restore ? "active" : "archived"}, updated_at = now() where id = ${store.id}::uuid`;
  await tx`update public.profiles set is_active = ${restore} where store_id = ${store.id}::uuid`;
});
for (const owner of owners) {
  const { error } = await supabase.auth.admin.updateUserById(owner.id, { ban_duration: restore ? "none" : "876000h" });
  if (error) throw error;
}
console.log(JSON.stringify({ ok: true, slug, storeId: store.id, status: restore ? "active" : "archived" }, null, 2));
await sql.end();
