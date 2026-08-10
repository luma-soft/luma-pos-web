import { readdirSync } from "node:fs";
import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL not set");
const sql = postgres(databaseUrl, { max: 1, prepare: false });

function assertAudit(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(`TENANT_AUTH_AUDIT_FAILED: ${message}`);
}

try {
  const [phoneAudit] = await sql<[{ total: number; invalid: number; duplicate_groups: number }]>`
    with normalized as (
      select case
        when phone is null or btrim(phone) = '' then null
        when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^0[0-9]{9,10}$'
          then '+84' || substring(regexp_replace(phone, '[^0-9]', '', 'g') from 2)
        when regexp_replace(phone, '[^0-9]', '', 'g') ~ '^84[0-9]{9,10}$'
          then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
        when btrim(phone) ~ '^\+[1-9][0-9 ()\.\-]{7,18}$'
          then '+' || regexp_replace(phone, '[^0-9]', '', 'g')
        else null
      end as value,
      phone
      from profiles
    ), duplicate_values as (
      select value from normalized
      where value is not null
      group by value having count(*) > 1
    )
    select
      count(*) filter (where phone is not null and btrim(phone) <> '')::int as total,
      count(*) filter (
        where phone is not null and btrim(phone) <> '' and value is null
      )::int as invalid,
      (select count(*)::int from duplicate_values) as duplicate_groups
    from normalized
  `;
  assertAudit(phoneAudit.duplicate_groups === 0, "duplicate normalized phones exist");

  const [column] = await sql<[{ exists: boolean }]>`
    select exists(
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name = 'profiles'
        and column_name = 'phone_normalized'
    ) as exists
  `;
  if (!column.exists) {
    console.log(JSON.stringify({ phase: "preflight", phoneAudit }, null, 2));
    process.exit(0);
  }

  const [isolation] = await sql<[{ null_phones: number; null_approval_stores: number; cross_store_approvals: number; cross_store_inviters: number }]>`
    select
      (select count(*)::int from profiles
        where phone is not null and btrim(phone) <> '' and phone_normalized is null) as null_phones,
      (select count(*)::int from mobile_approvals where store_id is null) as null_approval_stores,
      (select count(*)::int
        from mobile_approvals a
        join profiles requester on requester.id = a.requester_id
        join profiles approver on approver.id = a.approver_id
        where requester.store_id <> a.store_id or approver.store_id <> a.store_id
      ) as cross_store_approvals,
      (select count(*)::int
        from staff_invitations invitation
        join profiles inviter on inviter.id = invitation.invited_by
        where inviter.store_id <> invitation.store_id
      ) as cross_store_inviters
  `;
  assertAudit(Object.values(isolation).every((count) => count === 0), "tenant auth isolation mismatch");

  const migrationFiles = readdirSync("drizzle").filter((name) => name.endsWith(".sql"));
  const applied = await sql<{ name: string }[]>`select name from _migrations`;
  const appliedNames = new Set(applied.map((row) => row.name));
  const pendingMigrations = migrationFiles.filter((name) => !appliedNames.has(name)).sort();
  assertAudit(pendingMigrations.length === 0, `pending migrations: ${pendingMigrations.join(", ")}`);

  console.log(JSON.stringify({
    phase: "verified",
    phoneAudit,
    isolation,
    pendingMigrations,
  }, null, 2));
} finally {
  await sql.end();
}
