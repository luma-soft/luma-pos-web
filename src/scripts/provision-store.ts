/** Operations-only, idempotent store + first-owner provisioning. */
import { randomBytes } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import postgres from "postgres";
import { STORE_FEATURE_KEYS } from "@/lib/tenancy/store-features";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const slug = argument("slug")?.toLowerCase();
const storeName = argument("name");
const ownerEmail = argument("owner-email")?.toLowerCase();
const ownerName = argument("owner-name") || ownerEmail?.split("@")[0];
const disposable = process.argv.includes("--disposable");
const verifyIsolation = process.argv.includes("--verify-isolation");
const password = disposable ? `${randomBytes(24).toString("base64url")}Aa1!` : process.env.LUMA_OWNER_PASSWORD;
if (!slug?.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/) || !storeName || !ownerEmail || !password) {
  throw new Error("Usage: bun run ops:provision-store -- --slug <slug> --name <name> --owner-email <email> [--owner-name <name>] [--disposable]; set LUMA_OWNER_PASSWORD unless disposable");
}
const databaseUrl = process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!databaseUrl || !supabaseUrl || !serviceRoleKey) throw new Error("Missing operations credentials");

const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { autoRefreshToken: false, persistSession: false } });
const sql = postgres(databaseUrl, { max: 1, prepare: false });
let owner: User | null = null;
let createdAuthUser = false;
let databaseProvisioned = false;
for (let page = 1; !owner; page++) {
  const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 1000 });
  if (error) throw error;
  owner = data.users.find((user) => user.email?.toLowerCase() === ownerEmail) ?? null;
  if (data.users.length < 1000) break;
}
if (!owner) {
  const { data, error } = await supabase.auth.admin.createUser({ email: ownerEmail, password, email_confirm: true, user_metadata: { full_name: ownerName } });
  if (error) throw error;
  owner = data.user;
  createdAuthUser = true;
}

try {
  const result = await sql.begin(async (tx) => {
    const existingProfile = await tx<{ store_id: string }[]>`select store_id from public.profiles where id = ${owner!.id}::uuid`;
    const [store] = await tx<{ id: string; slug: string }[]>`
      insert into public.stores (slug, status) values (${slug}, 'active')
      on conflict (slug) do update set updated_at = now() returning id, slug
    `;
    if (existingProfile[0] && existingProfile[0].store_id !== store.id) throw new Error("Owner account already belongs to another store");
    await tx`
      insert into public.profiles (id, store_id, full_name, role, is_active)
      values (${owner!.id}::uuid, ${store.id}::uuid, ${ownerName!}, 'owner', true)
      on conflict (id) do update set full_name = excluded.full_name, role = 'owner', is_active = true
      where public.profiles.store_id = excluded.store_id
    `;
    await tx`
      insert into public.store_settings (store_id, id, name, prefs, onboarded)
      values (${store.id}::uuid, 'default', ${storeName}, '{}'::jsonb, false)
      on conflict (store_id) do nothing
    `;
    await tx`insert into public.catalog_sync_state (store_id, id, revision) values (${store.id}::uuid, 1, 1) on conflict (store_id, id) do nothing`;
    for (const featureKey of STORE_FEATURE_KEYS) {
      await tx`insert into public.store_features (store_id, feature_key, enabled) values (${store.id}::uuid, ${featureKey}, false) on conflict (store_id, feature_key) do nothing`;
    }
    await tx`
      insert into public.warehouses (store_id, name, is_default)
      select ${store.id}::uuid, 'Kho mặc định', true
      where not exists (select 1 from public.warehouses where store_id = ${store.id}::uuid and is_default = true)
    `;
    await tx`
      insert into public.price_books (store_id, name, is_default, manager_only, cost_based, system_type, sort_order)
      select ${store.id}::uuid, seed.name, seed.is_default, seed.manager_only, seed.cost_based, seed.system_type, seed.sort_order
      from (values ('Giá Chung', true, false, false, 'retail', 0), ('Giá vốn', false, true, true, 'cost', 1), ('Giá Chưa Chiết Khấu', false, true, false, 'purchase', 2)) seed(name, is_default, manager_only, cost_based, system_type, sort_order)
      where not exists (select 1 from public.price_books p where p.store_id = ${store.id}::uuid and p.system_type = seed.system_type)
    `;
    await tx`
      insert into public.print_templates (store_id, name, doc_type, paper_default, is_default, is_active, sort_order, store_name, options)
      select ${store.id}::uuid, seed.name, seed.doc_type::print_doc_type, seed.paper::paper_size, true, true, 0, ${storeName},
        '{"showSeller":true,"showProject":true,"showDebt":true,"showDiscount":true,"showTax":true,"showLineDiscount":true,"showInWords":true,"showSignatures":true,"showSku":false}'::jsonb
      from (values
        ('Mẫu hóa đơn mặc định', 'order', 'a5'), ('Mẫu báo giá mặc định', 'quote', 'a4'),
        ('Mẫu đặt hàng mặc định', 'booking', 'a4'), ('Mẫu nhập hàng mặc định', 'purchase', 'a4'),
        ('Mẫu trả hàng mặc định', 'return', 'a5'), ('Mẫu biên nhận mặc định', 'receipt', 'a5')
      ) seed(name, doc_type, paper)
      where not exists (select 1 from public.print_templates p where p.store_id = ${store.id}::uuid and p.doc_type = seed.doc_type::print_doc_type)
    `;
    const [counts] = await tx<{ profiles: number; products: number; customers: number; features_enabled: number }[]>`
      select (select count(*)::int from public.profiles where store_id = ${store.id}::uuid) profiles,
        (select count(*)::int from public.products where store_id = ${store.id}::uuid) products,
        (select count(*)::int from public.customers where store_id = ${store.id}::uuid) customers,
        (select count(*)::int from public.store_features where store_id = ${store.id}::uuid and enabled) features_enabled
    `;
    return { storeId: store.id, slug: store.slug, ownerId: owner!.id, ...counts };
  });
  databaseProvisioned = true;
  let directClientIsolation: Record<string, number | null> | undefined;
  if (verifyIsolation) {
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!anonKey) throw new Error("NEXT_PUBLIC_SUPABASE_ANON_KEY is required for isolation verification");
    const client = createClient(supabaseUrl, anonKey, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error: signInError } = await client.auth.signInWithPassword({ email: ownerEmail, password });
    if (signInError) throw signInError;
    directClientIsolation = {};
    for (const table of ["products", "customers", "orders"] as const) {
      const { count, error } = await client.from(table).select("id", { count: "exact", head: true });
      if (error) throw error;
      directClientIsolation[table] = count;
      if (count !== 0) throw new Error(`Direct-client tenant isolation failed for ${table}`);
    }
    await client.auth.signOut();
  }
  console.log(JSON.stringify({ ok: true, createdAuthUser, ...result, directClientIsolation }, null, 2));
} catch (error) {
  if (!databaseProvisioned && createdAuthUser && owner) await supabase.auth.admin.deleteUser(owner.id);
  throw error;
} finally {
  await sql.end();
}
