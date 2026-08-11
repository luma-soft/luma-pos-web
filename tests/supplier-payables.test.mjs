import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { eq, sql } from "drizzle-orm";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";

const project = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const STORE_ID = "00000000-0000-4000-8000-000000000001";
const schema = await import(`${project}/src/db/schema.ts`);
const {
  createSupplierPayableEntry,
  paySupplierPayable,
} = await import(`${project}/src/lib/payables/service-core.ts`);
const { getSupplierPayableOverview } = await import(
  `${project}/src/lib/data/supplier-payables.ts`
);

const client = new PGlite();
const database = drizzle(client, { schema });
await client.exec("create role anon; create role authenticated;");
for (const file of readdirSync(`${project}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${project}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension|gin_trgm_ops/i.test(sql)) await client.exec(sql);
  }
}

const [warehouse] = await database
  .insert(schema.warehouses)
  .values({ name: "Kho chính", isDefault: true })
  .returning({ id: schema.warehouses.id });
const [supplier] = await database
  .insert(schema.suppliers)
  .values({ code: "NCC-TEST", name: "Nhà cung cấp test", currentDebt: "700.00" })
  .returning({ id: schema.suppliers.id });
const [purchase] = await database
  .insert(schema.purchaseOrders)
  .values({
    code: "PN-TEST",
    supplierId: supplier.id,
    warehouseId: warehouse.id,
    status: "received",
    subtotal: "1000.00",
    total: "1000.00",
    amountPaid: "300.00",
  })
  .returning({ id: schema.purchaseOrders.id });

const actor = { storeId: STORE_ID, profileId: null, shiftId: null };
const paymentInput = {
  supplierId: supplier.id,
  amount: 300,
  method: "cash",
  allocations: [{ purchaseOrderId: purchase.id, amount: 300 }],
  clientRequestId: "supplier-payable-test-001",
};
const paid = await paySupplierPayable(database, paymentInput, actor);
assert.equal(paid.ok, true);
assert.equal(paid.data.replayed, false);

const [afterPaymentSupplier] = await database
  .select({ currentDebt: schema.suppliers.currentDebt })
  .from(schema.suppliers)
  .where(eq(schema.suppliers.id, supplier.id));
const [afterPaymentPurchase] = await database
  .select({ amountPaid: schema.purchaseOrders.amountPaid })
  .from(schema.purchaseOrders)
  .where(eq(schema.purchaseOrders.id, purchase.id));
assert.equal(Number(afterPaymentSupplier.currentDebt), 400);
assert.equal(Number(afterPaymentPurchase.amountPaid), 600);

const replayedPayment = await paySupplierPayable(database, paymentInput, actor);
assert.equal(replayedPayment.ok, true);
assert.equal(replayedPayment.data.replayed, true);
const [receiptCount] = await database
  .select({ count: sql`count(*)::int` })
  .from(schema.supplierPayableReceipts);
assert.equal(Number(receiptCount.count), 1);

const conflictingPayment = await paySupplierPayable(database, {
  ...paymentInput,
  amount: 200,
  allocations: [{ purchaseOrderId: purchase.id, amount: 200 }],
}, actor);
assert.deepEqual(conflictingPayment, { ok: false, error: "payments.errors.referenceConflict" });

const conflictingPaymentMetadata = await paySupplierPayable(database, {
  ...paymentInput,
  note: "Nội dung khác với yêu cầu gốc",
}, actor);
assert.deepEqual(conflictingPaymentMetadata, { ok: false, error: "payments.errors.referenceConflict" });

const adjustmentInput = {
  supplierId: supplier.id,
  amount: -100,
  reason: "Đối soát hóa đơn",
  clientRequestId: "supplier-payable-adjust-001",
};
const adjusted = await createSupplierPayableEntry(database, adjustmentInput, actor);
assert.equal(adjusted.ok, true);
assert.equal(adjusted.data.replayed, false);
const replayedAdjustment = await createSupplierPayableEntry(database, adjustmentInput, actor);
assert.equal(replayedAdjustment.ok, true);
assert.equal(replayedAdjustment.data.replayed, true);

const [afterAdjustmentSupplier] = await database
  .select({ currentDebt: schema.suppliers.currentDebt })
  .from(schema.suppliers)
  .where(eq(schema.suppliers.id, supplier.id));
assert.equal(Number(afterAdjustmentSupplier.currentDebt), 300);
const auditRows = await database
  .select({ action: schema.auditLogs.action, after: schema.auditLogs.after })
  .from(schema.auditLogs);
assert.ok(auditRows.some((row) => row.action === "supplier_payable.payment.create"));
assert.ok(auditRows.some((row) =>
  row.action === "supplier_payable.adjustment.create" && row.after.reason === "Đối soát hóa đơn"
));

const excessiveAdjustment = await createSupplierPayableEntry(database, {
  supplierId: supplier.id,
  amount: -301,
  reason: "Không hợp lệ",
  clientRequestId: "supplier-payable-adjust-002",
}, actor);
assert.deepEqual(excessiveAdjustment, { ok: false, error: "orders.errors.amountExceedsRemaining" });

const increased = await createSupplierPayableEntry(database, {
  supplierId: supplier.id,
  amount: 100,
  reason: "Phí vận chuyển bổ sung",
  clientRequestId: "supplier-payable-adjust-003",
}, actor);
assert.equal(increased.ok, true);
const unallocatedPaymentInput = {
  supplierId: supplier.id,
  amount: 100,
  method: "bank_transfer",
  allocations: [],
  clientRequestId: "supplier-payable-unallocated-004",
};
const unallocatedPayment = await paySupplierPayable(
  database,
  unallocatedPaymentInput,
  actor,
);
assert.equal(unallocatedPayment.ok, true);
const replayedUnallocatedPayment = await paySupplierPayable(
  database,
  unallocatedPaymentInput,
  actor,
);
assert.equal(replayedUnallocatedPayment.ok, true);
assert.equal(replayedUnallocatedPayment.data.replayed, true);

const overview = await getSupplierPayableOverview(STORE_ID, supplier.id, database);
assert.ok(overview);
assert.equal(overview.currentDebt, 300);
assert.equal(overview.invoices[0].remaining, 400);
assert.ok(overview.ledger.some((row) => row.kind === "purchase"));
assert.deepEqual(
  overview.ledger
    .filter((row) => row.kind === "payment")
    .map((row) => row.value)
    .sort((a, b) => a - b),
  [-300, -300, -100],
);
assert.ok(overview.ledger.some((row) => row.kind === "adjustment" && row.value === -100));
assert.equal(overview.ledger[0].balance, 300);
const supplierCashRows = await database
  .select({
    type: schema.cashTransactions.type,
    category: schema.cashTransactions.category,
    amount: schema.cashTransactions.amount,
  })
  .from(schema.cashTransactions);
assert.equal(supplierCashRows.length, 2);
assert.ok(supplierCashRows.every((row) =>
  row.type === "out" && row.category === "supplier_payment"
));
assert.deepEqual(
  supplierCashRows.map((row) => Number(row.amount)).sort((a, b) => a - b),
  [100, 300],
);

console.log("supplier payables transaction and ledger test passed");

await client.close();
