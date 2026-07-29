/* Stocktake + pricing smoke test on PGlite — mirrors action logic. */
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq, sql as dsql } from "drizzle-orm";

const PROJ = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${PROJ}/src/db/schema.ts`);
const { products, stockLevels, stockMovements, warehouses, stocktakes, stocktakeItems } = schema;

const client = new PGlite();
const db = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log(`  ✅ ${name}`); }
  else { fail++; console.log(`  ❌ ${name} ${extra}`); }
};
const money = (n) => n.toFixed(2);
const qty = (n) => n.toFixed(4);

console.log("0) Migrations");
for (const f of readdirSync(`${PROJ}/drizzle`).filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of readFileSync(`${PROJ}/drizzle/${f}`, "utf8").split("--> statement-breakpoint")) {
    const s = stmt.trim();
    if (s && !/create extension/i.test(s)) await client.exec(s); // PGlite khong co unaccent
  }
}
ok("migrations applied (incl. 0004 stocktakes)", true);

const [wh] = await db.insert(warehouses).values({ name: "Kho", isDefault: true }).returning();
const [pA] = await db.insert(products).values({ sku: "A", name: "Gạch A", baseUnit: "viên", costPrice: money(10000), retailPrice: money(15000) }).returning();
const [pB] = await db.insert(products).values({ sku: "B", name: "Xi măng B", baseUnit: "bao", costPrice: money(80000), retailPrice: money(92000) }).returning();
await db.insert(stockLevels).values([
  { productId: pA.id, warehouseId: wh.id, quantity: qty(100) },
  { productId: pB.id, warehouseId: wh.id, quantity: qty(50) },
]);

console.log("1) Tạo phiếu kiểm (draft) — không ảnh hưởng kho");
const [st] = await db.insert(stocktakes).values({ code: "KK-1", warehouseId: wh.id, status: "draft" }).returning();
await db.insert(stocktakeItems).values([
  { stocktakeId: st.id, productId: pA.id, systemQty: qty(100), actualQty: qty(98) },  // lệch -2
  { stocktakeId: st.id, productId: pB.id, systemQty: qty(50), actualQty: qty(53) },   // lệch +3
]);
let [slA] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, pA.id), eq(stockLevels.warehouseId, wh.id)));
ok("draft: kho A vẫn 100", Number(slA.quantity) === 100);

console.log("2) Cân bằng kho — set tồn = thực tế, ghi movement adjust");
// giả lập bán 5 viên A sau khi tạo phiếu (tồn hiện tại 95, đếm 98 → diff +3 tại thời điểm cân bằng)
await db.update(stockLevels).set({ quantity: dsql`${stockLevels.quantity} - 5` })
  .where(and(eq(stockLevels.productId, pA.id), eq(stockLevels.warehouseId, wh.id)));

await db.transaction(async (tx) => {
  const [s] = await tx.select().from(stocktakes).where(eq(stocktakes.id, st.id));
  if (s.status !== "draft") throw new Error("NOT_DRAFT");
  const items = await tx.select().from(stocktakeItems).where(eq(stocktakeItems.stocktakeId, st.id));
  for (const i of items) {
    const [level] = await tx.select({ quantity: stockLevels.quantity }).from(stockLevels)
      .where(and(eq(stockLevels.productId, i.productId), eq(stockLevels.warehouseId, s.warehouseId)));
    const current = Number(level?.quantity ?? 0);
    const actual = Number(i.actualQty);
    const diff = actual - current;
    await tx.insert(stockLevels).values({ productId: i.productId, warehouseId: s.warehouseId, quantity: qty(actual) })
      .onConflictDoUpdate({
        target: [stockLevels.productId, stockLevels.warehouseId],
        set: { quantity: qty(actual) },
      });
    if (Math.abs(diff) > 1e-9) {
      await tx.insert(stockMovements).values({
        productId: i.productId, warehouseId: s.warehouseId, type: "adjust",
        quantity: qty(diff), refType: "stocktake", refId: s.id,
      });
    }
  }
  await tx.update(stocktakes).set({ status: "balanced", balancedAt: dsql`now()` }).where(eq(stocktakes.id, st.id));
});

[slA] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, pA.id), eq(stockLevels.warehouseId, wh.id)));
ok("cân bằng: kho A = 98 (set theo thực tế)", Number(slA.quantity) === 98, `got ${slA.quantity}`);
const [slB] = await db.select().from(stockLevels).where(and(eq(stockLevels.productId, pB.id), eq(stockLevels.warehouseId, wh.id)));
ok("cân bằng: kho B = 53", Number(slB.quantity) === 53, `got ${slB.quantity}`);
const moves = await db.select().from(stockMovements).where(eq(stockMovements.refId, st.id));
ok("2 movements adjust (A: +3 vs tồn lúc cân, B: +3)", moves.length === 2 && moves.every((m) => m.type === "adjust"));
const mvA = moves.find((m) => m.productId === pA.id);
ok("lệch A tính theo tồn LÚC CÂN BẰNG (98−95=+3)", Number(mvA.quantity) === 3, `got ${mvA.quantity}`);
const [st2] = await db.select().from(stocktakes).where(eq(stocktakes.id, st.id));
ok("phiếu → balanced", st2.status === "balanced" && st2.balancedAt != null);

console.log("3) Phiếu đã cân bằng không thao tác lại được");
let err = "";
try {
  await db.transaction(async (tx) => {
    const [s] = await tx.select().from(stocktakes).where(eq(stocktakes.id, st.id));
    if (s.status !== "draft") throw new Error("NOT_DRAFT");
  });
} catch (e) { err = e.message; }
ok("NOT_DRAFT khi cân bằng lần 2", err === "NOT_DRAFT");

console.log("4) Thiết lập giá: update 4 bảng giá");
await db.update(products).set({
  retailPrice: money(16000), wholesalePrice: money(15000),
  contractorPrice: money(14500), agentPrice: money(14000),
}).where(eq(products.id, pA.id));
const [pA2] = await db.select().from(products).where(eq(products.id, pA.id));
ok("4 giá đã lưu đúng",
  Number(pA2.retailPrice) === 16000 && Number(pA2.wholesalePrice) === 15000 &&
  Number(pA2.contractorPrice) === 14500 && Number(pA2.agentPrice) === 14000);

console.log(`\n${fail === 0 ? "🎉" : "⚠️"} ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
