import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import type { PoolClient } from "pg";

/**
 * Merges products that exist twice: one created in Luma POS (POS SKU such as
 * SPMU5J3S9B089) and a copy a KiotViet sync created later under the KiotViet
 * SKU (SP053475), because the sync only matched on mapping/SKU.
 *
 *   bun run src/scripts/merge-duplicate-products.ts --store=hai-dang [--only=POS_SKU ...] [--report=tmp/x.csv] [--apply]
 *
 * A pair is two active products of the store with the same name, variant name
 * and attributes (specs), exactly one of them with a KiotViet SKU (SP + 6
 * digits). Per pair:
 * - The POS product is kept (the user keeps POS codes; the KiotViet SKU lives
 *   only in `product_source_mappings`).
 * - Sale and purchase lines move to the kept product.
 * - The KiotViet product mapping moves to the kept product, or is created from
 *   the copy's SKU, so later syncs recognise the product and do not copy it again.
 * - Stock stays the kept product's stock. The copy's stock came only from the
 *   KiotViet "init" opening of the same goods, so it is zeroed with an `adjust`
 *   movement (ref_type `product_merge`) instead of being added twice.
 * - Images, barcode, brand, category, supplier and description are copied to
 *   the kept product only where it has none.
 * - The copy is archived (inactive), never deleted.
 *
 * A pair is held (not merged) when anything is unexpected: different retail
 * price or unit, the copy has stock movements other than its opening, rows in
 * tables this script does not move, or the kept product already has a KiotViet
 * mapping.
 *
 * Without --apply the whole merge runs inside a transaction that is rolled back,
 * so the report shows the real outcome without writing anything.
 */

const STORE_SLUG = "hai-dang";
const KIOTVIET_SKU = "^SP[0-9]{6}$";

/** Tables the copy may not have rows in; the script does not move them. */
const UNSUPPORTED_REFERENCES: Array<{ table: string; where: string }> = [
  { table: "product_units", where: "product_id = $1" },
  { table: "product_prices", where: "product_id = $1" },
  { table: "product_suppliers", where: "product_id = $1" },
  { table: "product_media", where: "product_id = $1" },
  { table: "inventory_cost_baselines", where: "product_id = $1" },
  { table: "inventory_cost_adjustments", where: "product_id = $1" },
  { table: "marketplace_product_mappings", where: "product_id = $1" },
  { table: "product_attribute_products", where: "product_id = $1" },
  { table: "product_variant_members", where: "product_id = $1" },
  { table: "promotions", where: "product_id = $1" },
  { table: "ai_listing_suggestions", where: "product_id = $1" },
  { table: "product_combo_items", where: "$1 in (combo_product_id, component_product_id)" },
  { table: "stock_lots", where: "product_id = $1" },
  { table: "stocktake_items", where: "product_id = $1" },
  { table: "return_items", where: "product_id = $1" },
  { table: "purchase_return_items", where: "product_id = $1" },
  { table: "internal_use_items", where: "product_id = $1" },
  { table: "service_job_materials", where: "product_id = $1" },
  { table: "installed_assets", where: "product_id = $1" },
  { table: "products", where: "$1 in (parent_product_id, related_product_id)" },
];

/** Document lines that move to the kept product. */
const MOVED_LINES = ["order_items", "purchase_order_items"] as const;

export interface MergeArgs { only: string[]; report: string | null; apply: boolean }

export function parseMergeArgs(argv: string[]): MergeArgs {
  let store = "";
  const only: string[] = [];
  let report: string | null = null;
  let apply = false;
  for (const argument of argv) {
    if (argument === "--apply") apply = true;
    else if (argument.startsWith("--store=")) store = argument.slice("--store=".length).trim();
    else if (argument.startsWith("--only=")) only.push(argument.slice("--only=".length).trim());
    else if (argument.startsWith("--report=")) report = argument.slice("--report=".length).trim() || null;
    else throw new Error(`Unsupported option: ${argument}`);
  }
  if (store !== STORE_SLUG) throw new Error(`--store=${STORE_SLUG} is required`);
  return { only: [...new Set(only.filter(Boolean))], report, apply };
}

interface ProductRow {
  id: string; sku: string; name: string; base_unit: string; retail_price: string; cost_price: string;
  total_stock: string; image_urls: unknown[]; barcode: string | null;
}

interface PairResult {
  name: string; keepSku: string; dropSku: string; status: "merged" | "held"; reason: string;
  keepStock: number; dropStock: number; finalStock: number | null;
  orderLines: number; purchaseLines: number; mapping: string; copied: string[];
  keepPurchases: string; dropPurchases: string;
}

const DEFAULT_REPORT = () => `tmp/gop-san-pham-trung-${new Date().toISOString().slice(0, 10)}.csv`;

async function findPairs(client: PoolClient, storeId: string) {
  const { rows } = await client.query<{ keep: ProductRow; drop: ProductRow }>(`
    with p as (
      select p.*, lower(regexp_replace(trim(p.name), '\\s+', ' ', 'g')) || '|' || lower(coalesce(trim(p.variant_name), ''))
               || '|' || coalesce(nullif(p.specs::text, '{}'), '') as nk
      from products p
      where p.store_id = $1 and p.lifecycle_status in ('active', 'draft') and not coalesce(p.is_variant_parent, false)
    ), g as (
      select nk from p group by nk
      having count(*) = 2 and count(*) filter (where sku ~ '${KIOTVIET_SKU}') = 1
    )
    select to_jsonb(k) as keep, to_jsonb(d) as drop
    from g
    join p k on k.nk = g.nk and k.sku !~ '${KIOTVIET_SKU}'
    join p d on d.nk = g.nk and d.sku ~ '${KIOTVIET_SKU}'
    order by k.name`, [storeId]);
  return rows;
}

async function purchaseSummary(client: PoolClient, productId: string) {
  const { rows } = await client.query<{ s: string }>(`
    select coalesce(string_agg(po.code || ' ' || to_char(po.created_at at time zone 'Asia/Ho_Chi_Minh', 'DD/MM/YY')
             || ' x' || trim(to_char(i.quantity, 'FM999990.##')), '; ' order by po.created_at), '') as s
    from purchase_order_items i join purchase_orders po on po.id = i.purchase_order_id
    where i.product_id = $1`, [productId]);
  return rows[0]?.s ?? "";
}

async function holdReason(client: PoolClient, storeId: string, keep: ProductRow, drop: ProductRow) {
  if (Number(keep.retail_price) !== Number(drop.retail_price)) return `giá bán khác (${keep.retail_price} / ${drop.retail_price})`;
  if (keep.base_unit.trim().toLowerCase() !== drop.base_unit.trim().toLowerCase()) return `đơn vị khác (${keep.base_unit} / ${drop.base_unit})`;
  const movements = await client.query<{ n: string }>(
    `select count(*) n from stock_movements where product_id = $1 and not (type = 'init' and ref_type in ('kiotviet_product_sync', 'product_init'))`,
    [drop.id]);
  if (Number(movements.rows[0].n) > 0) return `bản ${drop.sku} có biến động kho ngoài tồn đầu`;
  for (const reference of UNSUPPORTED_REFERENCES) {
    const { rows } = await client.query<{ n: string }>(`select count(*) n from ${reference.table} where ${reference.where}`, [drop.id]);
    if (Number(rows[0].n) > 0) return `bản ${drop.sku} có dữ liệu trong ${reference.table}`;
  }
  const keepMapping = await client.query(
    `select 1 from product_source_mappings where store_id = $1 and provider = 'kiotviet' and product_id = $2 and deleted_at is null`,
    [storeId, keep.id]);
  if (keepMapping.rowCount) return `bản ${keep.sku} đã có mapping KiotViet`;
  return null;
}

async function mergePair(client: PoolClient, storeId: string, keep: ProductRow, drop: ProductRow): Promise<PairResult> {
  const base: PairResult = {
    name: keep.name, keepSku: keep.sku, dropSku: drop.sku, status: "held", reason: "",
    keepStock: Number(keep.total_stock), dropStock: Number(drop.total_stock), finalStock: null,
    orderLines: 0, purchaseLines: 0, mapping: "", copied: [],
    keepPurchases: await purchaseSummary(client, keep.id), dropPurchases: await purchaseSummary(client, drop.id),
  };
  const reason = await holdReason(client, storeId, keep, drop);
  if (reason) return { ...base, reason };

  await client.query("savepoint merge_pair");
  try {
    for (const table of MOVED_LINES) {
      const moved = await client.query(`update ${table} set product_id = $2 where product_id = $1`, [drop.id, keep.id]);
      if (table === "order_items") base.orderLines = moved.rowCount ?? 0;
      else base.purchaseLines = moved.rowCount ?? 0;
    }

    const existing = await client.query<{ external_id: string }>(
      `update product_source_mappings set product_id = $3, updated_at = now()
       where store_id = $1 and provider = 'kiotviet' and product_id = $2 returning external_id`,
      [storeId, drop.id, keep.id]);
    if (existing.rowCount) base.mapping = `chuyển ${existing.rows[0].external_id}`;
    else {
      const taken = await client.query(
        `select 1 from product_source_mappings where store_id = $1 and provider = 'kiotviet' and external_id = $2`,
        [storeId, drop.sku]);
      if (taken.rowCount) throw new Error(`mapping KiotViet ${drop.sku} đã thuộc sản phẩm khác`);
      await client.query(
        `insert into product_source_mappings (store_id, product_id, provider, external_id, last_seen_at)
         values ($1, $2, 'kiotviet', $3, now())`, [storeId, keep.id, drop.sku]);
      base.mapping = `tạo ${drop.sku}`;
    }

    const levels = await client.query<{ warehouse_id: string; quantity: string }>(
      `select warehouse_id, quantity from stock_levels where store_id = $1 and product_id = $2 and quantity <> 0`,
      [storeId, drop.id]);
    for (const level of levels.rows) {
      await client.query(
        `insert into stock_movements (store_id, product_id, warehouse_id, type, quantity, unit_cost, ref_type, ref_id, note)
         values ($1, $2, $3, 'adjust', $4, $5, 'product_merge', $6, $7)`,
        [storeId, drop.id, level.warehouse_id, -Number(level.quantity), drop.cost_price, keep.id,
          `Gộp sản phẩm trùng vào ${keep.sku}: bỏ tồn đầu KiotViet của cùng hàng`]);
      await client.query(
        `update stock_levels set quantity = 0, updated_at = now() where store_id = $1 and product_id = $2 and warehouse_id = $3`,
        [storeId, drop.id, level.warehouse_id]);
    }

    const fill = await client.query<{ copied: string[] }>(`
      with d as (select * from products where id = $2)
      update products k set
        image_urls = case when coalesce(jsonb_array_length(k.image_urls), 0) = 0
                           and not exists (select 1 from product_media m where m.product_id = k.id and m.deleted_at is null)
                          then d.image_urls else k.image_urls end,
        barcode = coalesce(k.barcode, case when not exists (
                    select 1 from products o where o.store_id = k.store_id and o.id not in (k.id, d.id) and o.barcode = d.barcode)
                  then d.barcode end),
        brand_id = coalesce(k.brand_id, d.brand_id),
        category_id = coalesce(k.category_id, d.category_id),
        supplier_id = coalesce(k.supplier_id, d.supplier_id),
        description = coalesce(nullif(k.description, ''), d.description),
        updated_at = now()
      from d
      where k.id = $1
      returning array_remove(array[
        case when k.image_urls is distinct from (select image_urls from products where id = $1) then 'ảnh' end,
        case when k.barcode is distinct from (select barcode from products where id = $1) then 'mã vạch' end,
        case when k.brand_id is distinct from (select brand_id from products where id = $1) then 'thương hiệu' end,
        case when k.category_id is distinct from (select category_id from products where id = $1) then 'nhóm hàng' end,
        case when k.supplier_id is distinct from (select supplier_id from products where id = $1) then 'NCC' end,
        case when k.description is distinct from (select description from products where id = $1) then 'mô tả' end
      ], null) as copied`, [keep.id, drop.id]);
    base.copied = fill.rows[0]?.copied ?? [];

    await client.query(
      `update products set is_active = false, lifecycle_status = 'archived', updated_at = now(),
         description = concat_ws(E'\\n', nullif(description, ''), $2::text)
       where id = $1`,
      [drop.id, `Đã gộp vào ${keep.sku} (sản phẩm trùng) ngày ${new Date().toISOString().slice(0, 10)}`]);

    const after = await client.query<{ total_stock: string }>(`select total_stock from products where id = $1`, [keep.id]);
    await client.query("release savepoint merge_pair");
    return { ...base, status: "merged", finalStock: Number(after.rows[0].total_stock) };
  } catch (error) {
    await client.query("rollback to savepoint merge_pair");
    return { ...base, reason: `lỗi: ${error instanceof Error ? error.message : String(error)}` };
  }
}

const csvCell = (value: unknown) => {
  const text = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
};

function writeReport(path: string, results: PairResult[]) {
  const header = ["Trạng thái", "Lý do giữ lại", "Tên", "Giữ (mã POS)", "Gộp bỏ (mã KV)", "Tồn bản giữ", "Tồn bản bỏ",
    "Tồn sau gộp", "Dòng hóa đơn chuyển", "Dòng phiếu nhập chuyển", "Mapping KiotViet", "Bổ sung từ bản bỏ",
    "Phiếu nhập bản giữ", "Phiếu nhập bản bỏ"];
  const lines = results.map((r) => [
    r.status === "merged" ? "Gộp" : "Giữ lại", r.reason, r.name, r.keepSku, r.dropSku, r.keepStock, r.dropStock,
    r.finalStock, r.orderLines, r.purchaseLines, r.mapping, r.copied, r.keepPurchases, r.dropPurchases,
  ].map(csvCell).join(","));
  writeFileSync(path, `﻿${[header.join(","), ...lines].join("\n")}\n`);
}

async function main() {
  const args = parseMergeArgs(process.argv.slice(2));
  const { pool } = await import("../db");
  const client = await pool.connect();
  try {
    const store = await client.query<{ id: string }>(`select id from stores where slug = $1`, [STORE_SLUG]);
    if (!store.rowCount) throw new Error(`Store not found: ${STORE_SLUG}`);
    const storeId = store.rows[0].id;

    await client.query("begin");
    await client.query("set local lock_timeout = '10s'");
    let pairs = await findPairs(client, storeId);
    if (args.only.length > 0) pairs = pairs.filter((pair) => args.only.includes(pair.keep.sku));

    const results: PairResult[] = [];
    for (const pair of pairs) results.push(await mergePair(client, storeId, pair.keep, pair.drop));

    const merged = results.filter((r) => r.status === "merged");
    if (args.apply) await client.query("commit");
    else await client.query("rollback");

    console.table(results.map((r) => ({
      status: r.status === "merged" ? "gộp" : `GIỮ: ${r.reason}`, giu: r.keepSku, bo: r.dropSku,
      ton: `${r.keepStock} + ${r.dropStock} → ${r.finalStock ?? "-"}`, hd: r.orderLines, pn: r.purchaseLines,
      mapping: r.mapping, bosung: r.copied.join(", "), ten: r.name.slice(0, 40),
    })));
    const reportPath = args.report ?? DEFAULT_REPORT();
    writeReport(reportPath, results);
    console.log(`${pairs.length} cặp: ${merged.length} gộp, ${results.length - merged.length} giữ lại.`);
    console.log(args.apply ? "ĐÃ GHI vào database." : "Chạy thử: đã rollback, không ghi gì.");
    console.log(`Báo cáo: ${reportPath}`);
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
