import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  new URL("../../../drizzle/0151_cancel_merged_source_orders.sql", import.meta.url),
  "utf8",
);

test("historical merged sources become cancelled and point to the matching store's new order", async () => {
  const pg = new PGlite();
  try {
    await pg.exec(`
      create type order_status as enum ('completed', 'cancelled', 'merged');
      create table orders (
        id uuid primary key,
        store_id uuid not null,
        code text not null,
        status order_status not null,
        note text,
        replaced_by_order_id uuid,
        updated_at timestamptz not null default now()
      );
      insert into orders (id, store_id, code, status, note) values
        ('00000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-000000000010',
         'DHG-01', 'completed', 'Gộp từ: DH-01, DH-02'),
        ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000010',
         'DH-01', 'merged', 'Đơn nguồn · Đã gộp vào DHG-01'),
        ('00000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-000000000010',
         'DH-02', 'merged', 'Đã gộp vào DHG-01'),
        ('00000000-0000-0000-0000-000000000004', '00000000-0000-0000-0000-000000000020',
         'DHG-01', 'completed', null),
        ('00000000-0000-0000-0000-000000000005', '00000000-0000-0000-0000-000000000020',
         'DH-03', 'merged', 'Đã gộp vào UNKNOWN'),
        ('00000000-0000-0000-0000-000000000006', '00000000-0000-0000-0000-000000000010',
         'DH-OLD', 'cancelled', 'Hủy thủ công');
    `);
    await pg.exec(migration);
    await pg.exec(migration); // Rerunning a data migration must be safe.
    const { rows } = await pg.query(`
      select code, status, replaced_by_order_id as "replacedBy"
      from orders order by id
    `);
    expect(rows).toEqual([
      { code: "DHG-01", status: "completed", replacedBy: null },
      { code: "DH-01", status: "cancelled", replacedBy: "00000000-0000-0000-0000-000000000001" },
      { code: "DH-02", status: "cancelled", replacedBy: "00000000-0000-0000-0000-000000000001" },
      { code: "DHG-01", status: "completed", replacedBy: null },
      { code: "DH-03", status: "cancelled", replacedBy: null },
      { code: "DH-OLD", status: "cancelled", replacedBy: null },
    ]);
  } finally {
    await pg.close();
  }
});
