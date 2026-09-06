import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import * as schema from "@/db/schema";
import type { InventoryTransaction } from "./stock-lot-service";
import { reverseDocumentStockLots } from "./reverse-document-stock-lots";

const pg = new PGlite();
const database = drizzle(pg, { schema });
const storeId = randomUUID(), otherStore = randomUUID();
before(async () => {
  await pg.exec(`
    create table stock_lots (id uuid primary key, store_id uuid not null, available_quantity numeric(14,4) not null);
    create table stock_lot_movements (id uuid primary key default gen_random_uuid(), store_id uuid not null,
      stock_lot_id uuid not null references stock_lots(id), quantity numeric(14,4) not null,
      ref_type text not null, ref_id uuid not null, created_by uuid, created_at timestamptz default now());
  `);
});
after(async () => { await pg.close(); });
const reverse = (refId: string, refType = "internal_use") => database.transaction((tx) =>
  reverseDocumentStockLots(tx as unknown as InventoryTransaction, { storeId, refId, refType, createdBy: null }));
async function lot(available: number, tenant = storeId) {
  const id = randomUUID();
  await pg.query("insert into stock_lots values($1,$2,$3)", [id, tenant, available]);
  return id;
}
async function consume(lotId: string, refId: string, quantity: number, refType = "internal_use", tenant = storeId) {
  await pg.query("update stock_lots set available_quantity=available_quantity-$1 where id=$2", [quantity, lotId]);
  await pg.query("insert into stock_lot_movements(store_id,stock_lot_id,quantity,ref_type,ref_id) values($1,$2,$3,$4,$5)", [tenant, lotId, -quantity, refType, refId]);
}
async function available(id: string) {
  return Number((await pg.query<{ available_quantity: string }>("select available_quantity from stock_lots where id=$1", [id])).rows[0].available_quantity);
}

test("repeated document edits and deletion restore only current consumption per original lot", async () => {
  const id = randomUUID(), otherDocument = randomUUID();
  const first = await lot(10), second = await lot(20);
  await consume(first, id, 4);
  await reverse(id);
  assert.equal(await available(first), 10);
  await consume(first, otherDocument, 3);
  await consume(second, id, 7.1256);
  await reverse(id);
  assert.equal(await available(first), 7, "must not restore another document's consumption from the historical lot");
  assert.equal(await available(second), 20);
  await reverse(id);
  assert.equal(await available(second), 20, "repeated reversal must be idempotent");
});

test("purchase return reversals isolate tenants and reference types without consulting product tracking", async () => {
  const id = randomUUID(), own = await lot(10), foreign = await lot(10, otherStore);
  await consume(own, id, 2, "purchase_return");
  await consume(own, id, 1, "internal_use");
  await consume(foreign, id, 5, "purchase_return", otherStore);
  await reverse(id, "purchase_return");
  assert.equal(await available(own), 9);
  assert.equal(await available(foreign), 5);
});

test("lot restoration rolls back with its surrounding document transaction", async () => {
  const id = randomUUID(), stockLotId = await lot(8);
  await consume(stockLotId, id, 3);
  await assert.rejects(database.transaction(async (tx) => {
    await reverseDocumentStockLots(tx as unknown as InventoryTransaction, { storeId, refId: id, refType: "internal_use", createdBy: null });
    throw new Error("replacement failed");
  }), /replacement failed/);
  assert.equal(await available(stockLotId), 5);
  await reverse(id);
  assert.equal(await available(stockLotId), 8);
});
