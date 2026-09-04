import { afterAll, beforeAll, expect, mock, test } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { randomUUID } from "node:crypto";

const pg = new PGlite();
mock.module("@/db", () => ({ db: drizzle(pg) }));
const { getActivePromotions } = await import("./active-promotions");
const store = randomUUID(), other = randomUUID();
const live = randomUUID(), future = randomUUID(), expired = randomUUID(), inactive = randomUUID(), foreign = randomUUID();
beforeAll(async () => {
  await pg.exec(`create table promotions(product_id uuid, store_id uuid, tiers jsonb, is_active boolean, starts_at timestamptz, ends_at timestamptz);`);
  for (const [id, tenant, enabled, start, end] of [
    [live, store, true, "2000-01-01", "2100-01-01"],
    [future, store, true, "2100-01-01", null],
    [expired, store, true, null, "2000-01-01"],
    [inactive, store, false, null, null],
    [foreign, other, true, null, null],
  ]) await pg.query("insert into promotions values($1,$2,$3,$4,$5,$6)", [id, tenant, JSON.stringify([{ minQty: 4, discountPct: 10 }]), enabled, start, end]);
});
afterAll(async () => pg.close());
test("only current tenant's enabled and currently active promotion tiers enter the catalog", async () => {
  expect(await getActivePromotions(store)).toEqual({ [live]: [{ minQty: 4, discountPct: 10 }] });
  expect(await getActivePromotions(randomUUID())).toEqual({});
});
