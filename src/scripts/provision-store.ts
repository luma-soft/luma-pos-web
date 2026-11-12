/** Operations-only, idempotent store + first-owner provisioning for Luma Auth. */
import { randomBytes, randomUUID } from "node:crypto";
import postgres from "postgres";
import { hashPassword, isValidNewPassword } from "@/lib/auth/password";
import { STORE_FEATURE_KEYS } from "@/lib/tenancy/store-features";

function argument(name: string) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1]?.trim() : undefined;
}

const slug = argument("slug")?.toLowerCase();
const storeName = argument("name")?.trim();
const ownerEmail = argument("owner-email")?.trim();
const ownerEmailNormalized = ownerEmail?.toLowerCase();
const ownerName = argument("owner-name")?.trim() || ownerEmail?.split("@")[0];
const disposable = process.argv.includes("--disposable");
const password = disposable
  ? `${randomBytes(24).toString("base64url")}Aa1!`
  : process.env.LUMA_OWNER_PASSWORD;

if (
  !slug?.match(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  || !storeName
  || !ownerEmailNormalized?.match(/^[^\s@]+@[^\s@]+\.[^\s@]+$/)
  || !ownerName
  || !password
  || !isValidNewPassword(password)
) {
  throw new Error("Usage: bun run ops:provision-store -- --slug <slug> --name <store name> --owner-email <email> [--owner-name <name>] [--disposable]; set LUMA_OWNER_PASSWORD unless disposable");
}
if (process.env.LUMAPOS_AUTH_PROVIDER !== "lumapos") {
  throw new Error("Set LUMAPOS_AUTH_PROVIDER=lumapos before provisioning a self-hosted account");
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is not configured");
const encodedPassword = await hashPassword(password);
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const result = await sql.begin(async (tx) => {
    const [store] = await tx<{ id: string; slug: string; status: string }[]>`
      insert into public.stores (slug, status)
      values (${slug}, 'active')
      on conflict (slug) do update set updated_at = now()
      returning id, slug, status
    `;
    if (!store || store.status !== "active") {
      throw new Error("Store exists but is not active; review its status before provisioning");
    }

    const matchingOwners = await tx<{ id: string; store_id: string }[]>`
      select profile.id, profile.store_id
      from public.auth_credentials credential
      join public.profiles profile on profile.id = credential.profile_id
      where credential.email_normalized = ${ownerEmailNormalized}
      for update of profile
    `;
    if (matchingOwners.length > 1) throw new Error("Owner email maps to multiple profiles");
    const existingOwner = matchingOwners[0];
    if (existingOwner && existingOwner.store_id !== store.id) {
      throw new Error("Owner account already belongs to another store");
    }
    const ownerId = existingOwner?.id ?? randomUUID();

    if (!existingOwner) {
      await tx`
        insert into public.profiles (id, store_id, full_name, role, is_active)
        values (${ownerId}::uuid, ${store.id}::uuid, ${ownerName}, 'owner', true)
      `;
      await tx`
        insert into public.auth_credentials (
          profile_id, email, email_normalized, password_hash, password_hash_type,
          email_verified_at, must_reset_password, password_changed_at
        ) values (
          ${ownerId}::uuid, ${ownerEmail}, ${ownerEmailNormalized},
          ${encodedPassword.hash}, ${encodedPassword.type}, now(), false, now()
        )
      `;
    } else {
      await tx`
        update public.profiles
        set full_name = ${ownerName}, role = 'owner', is_active = true
        where id = ${ownerId}::uuid and store_id = ${store.id}::uuid
      `;
    }

    await tx`
      insert into public.store_settings (store_id, id, name, prefs, onboarded)
      values (${store.id}::uuid, 'default', ${storeName}, '{}'::jsonb, false)
      on conflict (store_id) do nothing
    `;
    await tx`
      insert into public.catalog_sync_state (store_id, id, revision)
      values (${store.id}::uuid, 1, 1)
      on conflict (store_id, id) do nothing
    `;
    for (const featureKey of STORE_FEATURE_KEYS) {
      await tx`
        insert into public.store_features (store_id, feature_key, enabled)
        values (${store.id}::uuid, ${featureKey}, false)
        on conflict (store_id, feature_key) do nothing
      `;
    }
    await tx`
      insert into public.warehouses (store_id, name, is_default)
      select ${store.id}::uuid, 'Kho mặc định', true
      where not exists (
        select 1 from public.warehouses
        where store_id = ${store.id}::uuid and is_default = true
      )
    `;
    await tx`
      insert into public.price_books (
        store_id, name, is_default, manager_only, cost_based, system_type, sort_order
      )
      select ${store.id}::uuid, seed.name, seed.is_default, seed.manager_only,
        seed.cost_based, seed.system_type, seed.sort_order
      from (values
        ('Giá vốn', false, true, true, 'cost', 0),
        ('Giá nhập cuối', false, true, false, 'purchase', 1),
        ('Giá chưa chiết khấu', false, false, false, 'list', 2),
        ('Giá chung', true, false, false, 'retail', 3)
      ) seed(name, is_default, manager_only, cost_based, system_type, sort_order)
      where not exists (
        select 1 from public.price_books price_book
        where price_book.store_id = ${store.id}::uuid
          and price_book.system_type = seed.system_type
      )
    `;
    await tx`
      insert into public.print_templates (
        store_id, name, doc_type, paper_default, is_default, is_active,
        sort_order, store_name, options
      )
      select ${store.id}::uuid, seed.name, seed.doc_type::print_doc_type,
        seed.paper::paper_size, true, true, 0, ${storeName},
        '{"showSeller":true,"showProject":true,"showDebt":true,"showDiscount":true,"showTax":true,"showLineDiscount":true,"showInWords":true,"showSignatures":true,"showSku":false}'::jsonb
      from (values
        ('Mẫu hóa đơn mặc định', 'order', 'a5'),
        ('Mẫu báo giá mặc định', 'quote', 'a4'),
        ('Mẫu đặt hàng mặc định', 'booking', 'a4'),
        ('Mẫu nhập hàng mặc định', 'purchase', 'a4'),
        ('Mẫu trả hàng mặc định', 'return', 'a5'),
        ('Mẫu biên nhận mặc định', 'receipt', 'a5')
      ) seed(name, doc_type, paper)
      where not exists (
        select 1 from public.print_templates template
        where template.store_id = ${store.id}::uuid
          and template.doc_type = seed.doc_type::print_doc_type
      )
    `;

    const [counts] = await tx<{ profiles: number; products: number; customers: number; features_enabled: number }[]>`
      select
        (select count(*)::int from public.profiles where store_id = ${store.id}::uuid) profiles,
        (select count(*)::int from public.products where store_id = ${store.id}::uuid) products,
        (select count(*)::int from public.customers where store_id = ${store.id}::uuid) customers,
        (select count(*)::int from public.store_features where store_id = ${store.id}::uuid and enabled) features_enabled
    `;
    return {
      storeId: store.id,
      slug: store.slug,
      ownerId,
      createdOwner: !existingOwner,
      ...counts,
    };
  });

  console.log(JSON.stringify({ ok: true, ...result }, null, 2));
} finally {
  await sql.end();
}
