/** Recoverable archive/restore for disposable PostgreSQL rollout stores. */
import postgres from "postgres";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const slug = argument("slug");
const restore = process.argv.includes("--restore");
if (!slug?.startsWith("codex-isolation-")) {
  throw new Error("Only codex-isolation-* disposable stores may be archived");
}
if (process.env.LUMAPOS_AUTH_PROVIDER !== "lumapos") {
  throw new Error("Set LUMAPOS_AUTH_PROVIDER=lumapos before archiving a self-hosted store");
}
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");

const sql = postgres(databaseUrl, { max: 1, prepare: false });
try {
  const result = await sql.begin(async (tx) => {
    const [store] = await tx<{ id: string; status: string }[]>`
      select id, status from public.stores where slug = ${slug} for update
    `;
    if (!store) throw new Error("Disposable store not found");
    if (restore && store.status === "active") {
      return { storeId: store.id, status: "active", changed: false };
    }
    if (!restore && store.status === "archived") {
      return { storeId: store.id, status: "archived", changed: false };
    }
    if (restore && store.status !== "archived") {
      throw new Error("Only archived stores can be restored");
    }
    if (!restore && store.status !== "active") {
      throw new Error("Only active stores can be archived");
    }

    if (!restore) {
      const [inactive] = await tx<{ count: number }[]>`
        select count(*)::int as count from public.profiles
        where store_id = ${store.id}::uuid and not is_active
      `;
      if ((inactive?.count ?? 0) > 0) {
        throw new Error("Archive stopped because the disposable store already has inactive profiles");
      }
    }

    await tx`
      update public.stores
      set status = ${restore ? "active" : "archived"}, updated_at = now()
      where id = ${store.id}::uuid
    `;
    await tx`
      update public.profiles
      set is_active = ${restore},
          cashier_pin_failed_attempts = 0, cashier_pin_locked_until = null
      where store_id = ${store.id}::uuid
    `;
    if (!restore) {
      await tx`
        update public.auth_sessions
        set revoked_at = coalesce(revoked_at, now())
        where store_id = ${store.id}::uuid and revoked_at is null
      `;
    }
    return { storeId: store.id, status: restore ? "active" : "archived", changed: true };
  });
  console.log(JSON.stringify({ ok: true, slug, ...result }, null, 2));
} finally {
  await sql.end();
}
