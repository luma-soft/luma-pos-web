import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";

// Real PostgreSQL semantics (WASM), not mocked trigger functions. The fixture
// creates only tables needed by the additive migration; older migrations own
// the real schema and already attach the core revision triggers.
test("delta journal records committed hard deletes, tenant isolation and replay floor", async () => {
  const pg = new PGlite();
  const storeA = "11111111-1111-4111-8111-111111111111";
  const storeB = "22222222-2222-4222-8222-222222222222";
  const productA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const productB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

  try {
    await pg.exec(`
      DO $ BEGIN
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
          CREATE ROLE anon;
        END IF;
        IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
          CREATE ROLE authenticated;
        END IF;
      END $;
      CREATE TABLE stores (id uuid PRIMARY KEY);
      CREATE TABLE catalog_sync_state (
        store_id uuid NOT NULL REFERENCES stores(id), id integer NOT NULL,
        revision bigint NOT NULL DEFAULT 1, updated_at timestamptz,
        PRIMARY KEY (store_id, id)
      );
      INSERT INTO stores(id) VALUES ('${storeA}'), ('${storeB}');
      INSERT INTO catalog_sync_state(store_id, id, revision)
        VALUES ('${storeA}', 1, 10), ('${storeB}', 1, 20);
      CREATE TABLE products (id uuid PRIMARY KEY, store_id uuid NOT NULL);
    `);

    const others = [
      "product_units", "product_prices", "stock_levels",
      "warehouses", "categories", "brands", "product_combo_items",
      "product_suppliers", "product_variant_members", "product_media",
      "suppliers", "media_objects", "orders", "order_items",
      "purchase_orders", "purchase_order_items", "product_variant_groups",
    ];
    for (const table of others) {
      await pg.exec(`CREATE TABLE ${table} (
        id uuid, store_id uuid NOT NULL, product_id uuid, combo_product_id uuid
      )`);
    }

    const migration = readFileSync("drizzle/0142_catalog_delta_journal.sql", "utf8");
    // The migration runner uses these as split markers; PostgreSQL safely
    // accepts each statement and DO block in order.
    for (const piece of migration.split("--> statement-breakpoint")) {
      if (piece.trim()) await pg.exec(piece);
    }
    await pg.exec(`
      CREATE TRIGGER products_catalog_revision
      AFTER INSERT OR UPDATE OR DELETE ON products
      FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
      CREATE TRIGGER warehouses_catalog_revision
      AFTER INSERT OR UPDATE OR DELETE ON warehouses
      FOR EACH ROW EXECUTE FUNCTION public.bump_product_catalog_revision();
    `);

    await pg.exec(`
      INSERT INTO products (id, store_id) VALUES ('${productA}', '${storeA}');
      INSERT INTO products (id, store_id) VALUES ('${productB}', '${storeB}');
      DELETE FROM products WHERE id = '${productA}';
    `);
    const events = await pg.query(`
      SELECT store_id::text, revision, product_id::text, requires_full
      FROM catalog_delta_events ORDER BY store_id, revision
    `);
    expect(events.rows.map((event) => ({
      ...event, revision: Number(event.revision),
    }))).toEqual([
      { store_id: storeA, revision: 11, product_id: productA, requires_full: false },
      { store_id: storeA, revision: 12, product_id: productA, requires_full: false },
      { store_id: storeB, revision: 21, product_id: productB, requires_full: false },
    ]);

    await pg.exec(`
      BEGIN;
      INSERT INTO products (id, store_id)
        VALUES ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', '${storeA}');
      ROLLBACK;
    `);
    const count = await pg.query(`
      SELECT count(*)::integer AS count FROM catalog_delta_events
      WHERE store_id = '${storeA}'
    `);
    expect(count.rows[0].count).toBe(2);

    await pg.exec(`
      INSERT INTO warehouses (store_id) VALUES ('${storeA}');
    `);
    const globalChange = await pg.query(`
      SELECT requires_full, product_id FROM catalog_delta_events
      WHERE store_id = '${storeA}' ORDER BY revision DESC LIMIT 1
    `);
    expect(globalChange.rows[0]).toEqual({
      requires_full: true, product_id: null,
    });

    await pg.exec(`
      UPDATE catalog_delta_events SET changed_at = now() - interval '20 days'
      WHERE store_id = '${storeA}' AND revision <= 12;
      SELECT public.prune_catalog_delta_events(interval '14 days');
    `);
    const floor = await pg.query(`
      SELECT floor_revision FROM catalog_delta_floors WHERE store_id = '${storeA}'
    `);
    expect(Number(floor.rows[0].floor_revision)).toBe(12);
    const otherFloor = await pg.query(`
      SELECT floor_revision FROM catalog_delta_floors WHERE store_id = '${storeB}'
    `);
    expect(Number(otherFloor.rows[0].floor_revision)).toBe(20);
  } finally {
    await pg.close();
  }
});
