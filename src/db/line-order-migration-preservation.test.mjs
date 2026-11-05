import { afterAll, beforeAll, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const pg = new PGlite();

beforeAll(async () => {
  await pg.exec(`
    create table public.purchase_order_items (
      id integer primary key, store_id integer not null, purchase_order_id integer not null, line_order integer
    );
    create table public.order_items (
      id integer primary key, store_id integer not null, order_id integer not null, line_order integer
    );
    create table public.return_items (
      id integer primary key, store_id integer not null, return_id integer not null, line_order integer
    );
    create table public.purchase_return_items (
      id integer primary key, store_id integer not null, purchase_return_id integer not null, line_order integer
    );
    create function public.noop_catalog_revision() returns trigger
      language plpgsql as $$ begin return new; end $$;
    create trigger order_items_catalog_revision
      after update on public.order_items
      for each row execute function public.noop_catalog_revision();
    insert into public.purchase_order_items values (1, 1, 1, 9), (2, 1, 1, null);
    insert into public.order_items values (1, 1, 1, 8), (2, 1, 1, 2), (3, 1, 1, null);
    insert into public.return_items values (1, 1, 1, 4), (2, 1, 1, null);
    insert into public.purchase_return_items values (1, 1, 1, 6), (2, 1, 1, null);
  `);
  await pg.exec(await readFile("drizzle/0147_purchase_order_item_line_order.sql", "utf8"));
  await pg.exec(await readFile("drizzle/0148_document_line_order.sql", "utf8"));
});

afterAll(async () => pg.close());

test("existing document line order is preserved while missing positions are filled", async () => {
  const orderItems = (await pg.query(
    "select id, line_order from public.order_items order by id",
  )).rows;
  const purchaseOrderItems = (await pg.query(
    "select id, line_order from public.purchase_order_items order by id",
  )).rows;
  const returnItems = (await pg.query(
    "select id, line_order from public.return_items order by id",
  )).rows;
  const purchaseReturnItems = (await pg.query(
    "select id, line_order from public.purchase_return_items order by id",
  )).rows;

  expect(orderItems.map((row) => [row.id, row.line_order])).toEqual([[1, 8], [2, 2], [3, 9]]);
  expect(purchaseOrderItems.map((row) => [row.id, row.line_order])).toEqual([[1, 9], [2, 10]]);
  expect(returnItems.map((row) => [row.id, row.line_order])).toEqual([[1, 4], [2, 5]]);
  expect(purchaseReturnItems.map((row) => [row.id, row.line_order])).toEqual([[1, 6], [2, 7]]);
});
