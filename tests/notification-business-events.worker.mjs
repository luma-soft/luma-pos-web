// Runs only in an isolated subprocess because Bun module mocks are process-wide.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { mock } from "bun:test";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";

const projectRoot = fileURLToPath(new URL("..", import.meta.url)).replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  customers,
  notificationEvents,
  orderItems,
  products,
  profiles,
  purchaseOrders,
  stockLevels,
  storeSettings,
  suppliers,
  warehouses,
} = schema;

const client = new PGlite();
const rawDb = drizzle(client, { schema });
let transactionDepth = 0;
const db = new Proxy(rawDb, {
  get(target, property, receiver) {
    if (property === "transaction") {
      return (callback) => target.transaction(async (tx) => {
        transactionDepth += 1;
        try {
          return await callback(tx);
        } finally {
          transactionDepth -= 1;
        }
      });
    }
    return Reflect.get(target, property, receiver);
  },
});

let codeSequence = 0;
const actorId = "10000000-0000-4000-8000-000000000001";
const publishedEventIds = [];
const publicationDepths = [];

mock.module("@/db", () => ({ db, schema }));
mock.module("next/cache", () => ({
  revalidatePath() {},
  unstable_cache(fn) {
    return fn;
  },
}));
mock.module("@/lib/data/shifts", () => ({
  async getCurrentShift() {
    return null;
  },
}));
mock.module("@/lib/actions/common", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {},
  async getProfileId() {
    return actorId;
  },
  async requireManager() {
    return { ok: true, userId: actorId, role: "owner" };
  },
  async requireOwner() {
    return { ok: true, userId: actorId, role: "owner" };
  },
  async requireStockAccess() {
    return { ok: true, userId: actorId, role: "owner" };
  },
  async requireSalesAccess() {
    return { ok: true, userId: actorId, role: "owner" };
  },
  generateCode(prefix) {
    codeSequence += 1;
    return `${prefix}-EVENT-${String(codeSequence).padStart(4, "0")}`;
  },
  isUniqueViolation(error) {
    return error instanceof Error && error.message.includes("duplicate key");
  },
  toMoney(value) {
    return value.toFixed(2);
  },
  toQty(value) {
    return value.toFixed(4);
  },
}));
mock.module("@/lib/notifications/outbox", () => ({
  async publishCommittedNotification(eventId) {
    publicationDepths.push(transactionDepth);
    publishedEventIds.push(eventId);
  },
}));

const { createOrderForUser } = await import(`${projectRoot}/src/lib/orders/create.ts`);
const { convertQuoteToOrderForUser } = await import(`${projectRoot}/src/lib/orders/convert.ts`);
const { cancelOrderForUser } = await import(`${projectRoot}/src/lib/orders/cancel.ts`);
const { addPaymentForUser } = await import(`${projectRoot}/src/lib/orders/payment.ts`);
const { importShopeeOrder } = await import(`${projectRoot}/src/lib/actions/marketplace.ts`);
const {
  cancelPurchase,
  createPurchase,
  updatePurchase,
} = await import(`${projectRoot}/src/lib/actions/purchases.ts`);
const { createPurchaseReturn } = await import(`${projectRoot}/src/lib/actions/purchase-returns.ts`);
const {
  createExchangeForUser,
  createPosReturn,
  createReturnForUser,
} = await import(`${projectRoot}/src/lib/actions/returns.ts`);

for (const file of readdirSync(`${projectRoot}/drizzle`).filter((name) => name.endsWith(".sql")).sort()) {
  for (const statement of readFileSync(`${projectRoot}/drizzle/${file}`, "utf8").split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql && !/create extension/i.test(sql)) await client.exec(sql);
  }
}
await client.exec(`
  CREATE TABLE "store_settings" (
    "id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
    "name" text DEFAULT '' NOT NULL,
    "address" text DEFAULT '' NOT NULL,
    "phone" text DEFAULT '' NOT NULL,
    "tax_code" text DEFAULT '' NOT NULL,
    "industry" text DEFAULT 'grocery' NOT NULL,
    "currency" text DEFAULT 'VND' NOT NULL,
    "locale" text DEFAULT 'vi-VN' NOT NULL,
    "onboarded" boolean DEFAULT false NOT NULL,
    "prefs" jsonb DEFAULT '{}'::jsonb NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
  )
`);

const [actor] = await db.insert(profiles).values([
  { id: actorId, fullName: "Actor", role: "owner" },
  { id: "10000000-0000-4000-8000-000000000002", fullName: "Recipient", role: "manager" },
]).returning();
await db.insert(storeSettings).values({ id: "default" });
const [warehouse] = await db.insert(warehouses).values({
  id: "20000000-0000-4000-8000-000000000001",
  name: "Event warehouse",
  isDefault: true,
}).returning();
const [customer] = await db.insert(customers).values({
  id: "30000000-0000-4000-8000-000000000001",
  code: "KH-EVENT",
  name: "Event customer",
}).returning();
const [supplier] = await db.insert(suppliers).values({
  id: "40000000-0000-4000-8000-000000000001",
  code: "NCC-EVENT",
  name: "Event supplier",
}).returning();
const [otherSupplier] = await db.insert(suppliers).values({
  id: "40000000-0000-4000-8000-000000000002",
  code: "NCC-EVENT-OTHER",
  name: "Other event supplier",
}).returning();
const [product, trackedProduct] = await db.insert(products).values([
  {
    id: "50000000-0000-4000-8000-000000000001",
    sku: "SKU-EVENT",
    name: "Event product",
    baseUnit: "cái",
    retailPrice: "100.00",
  },
  {
    id: "50000000-0000-4000-8000-000000000002",
    sku: "SKU-BATCH-EVENT",
    name: "Tracked event product",
    baseUnit: "cái",
    retailPrice: "100.00",
    trackBatches: true,
    shelfLifeDays: 30,
  },
]).returning();
await db.insert(stockLevels).values({
  productId: product.id,
  warehouseId: warehouse.id,
  quantity: "100.0000",
});

let passed = 0;
let failed = 0;
function ok(name, condition, detail = "") {
  if (condition) {
    passed += 1;
    console.log(`ok - ${name}`);
  } else {
    failed += 1;
    console.error(`not ok - ${name}${detail ? ` (${detail})` : ""}`);
  }
}

async function eventsFor(entityType, entityId) {
  return db.select().from(notificationEvents).where(and(
    eq(notificationEvents.entityType, entityType),
    eq(notificationEvents.entityId, entityId),
  ));
}

const saleInput = {
  mode: "sale",
  clientId: "event-direct-sale",
  customerId: customer.id,
  warehouseId: warehouse.id,
  items: [{ productId: product.id, unitName: "cái", quantity: 1 }],
  payment: { method: "credit", amount: 0 },
};
const sale = await createOrderForUser(actor.id, saleInput);
ok("direct sale succeeds", sale.ok, sale.ok ? "" : sale.error);
const [saleEvent] = sale.ok ? await eventsFor("order", sale.data.id) : [];
ok("completed sale emits invoice event", saleEvent?.category === "invoiceCreated");
ok(
  "completed sale invoice protects debt metadata",
  saleEvent?.metadata?.debtDelta === "100.00" && saleEvent?.metadata?.source === "sale",
);
const publicationsBeforeSaleReplay = publishedEventIds.length;
const saleReplay = await createOrderForUser(actor.id, saleInput);
const saleEventsAfterReplay = sale.ok ? await eventsFor("order", sale.data.id) : [];
ok(
  "direct sale replay returns early without duplicate event or publication",
  sale.ok
    && saleReplay.ok
    && saleReplay.data.id === sale.data.id
    && saleEventsAfterReplay.length === 1
    && publishedEventIds.length === publicationsBeforeSaleReplay,
  JSON.stringify({ sale, saleReplay, saleEventsAfterReplay, publishedEventIds }),
);

const quote = await createOrderForUser(actor.id, {
  mode: "quote",
  clientId: "event-quote",
  customerId: customer.id,
  warehouseId: warehouse.id,
  items: [{ productId: product.id, unitName: "cái", quantity: 1 }],
  payment: { method: "credit", amount: 0 },
});
const booking = await createOrderForUser(actor.id, {
  mode: "booking",
  clientId: "event-booking",
  customerId: customer.id,
  warehouseId: warehouse.id,
  items: [{ productId: product.id, unitName: "cái", quantity: 1 }],
  payment: { method: "credit", amount: 0 },
});
const quoteEvents = quote.ok ? await eventsFor("order", quote.data.id) : [];
const bookingEvents = booking.ok ? await eventsFor("order", booking.data.id) : [];
ok("quote and booking emit no invoice event", quoteEvents.length === 0 && bookingEvents.length === 0);

const converted = quote.ok
  ? await convertQuoteToOrderForUser(actor.id, quote.data.id)
  : { ok: false, error: "quote setup failed" };
const convertedEvents = quote.ok ? await eventsFor("order", quote.data.id) : [];
ok("quote conversion emits invoice event", converted.ok && convertedEvents.length === 1);

const qrDraft = await createOrderForUser(actor.id, {
  mode: "sale",
  clientId: "event-pending-qr",
  customerId: customer.id,
  warehouseId: warehouse.id,
  paymentPending: true,
  items: [{ productId: product.id, unitName: "cái", quantity: 1 }],
  payment: { method: "credit", amount: 0 },
});
const qrDraftEvents = qrDraft.ok ? await eventsFor("order", qrDraft.data.id) : [];
ok("pending QR draft emits no invoice event", qrDraft.ok && qrDraftEvents.length === 0);

const marketplaceInput = {
  orderSn: "SHP-EVENT-1",
  status: "READY_TO_SHIP",
  buyerName: "Marketplace buyer",
  buyerPhone: "0900000001",
  deliveryAddress: "Marketplace address",
  shippingFee: 0,
  total: 100,
  items: [{ productId: product.id, name: product.name, quantity: 1, unitPrice: 100 }],
  rawPayload: { source: "event-test" },
};
const marketplace = await importShopeeOrder(marketplaceInput);
const marketplaceReplay = await importShopeeOrder(marketplaceInput);
const marketplaceEvents = marketplace.ok ? await eventsFor("order", marketplace.data.orderId) : [];
ok(
  "completed marketplace import emits invoice event once",
  marketplace.ok && marketplaceReplay.ok && marketplaceReplay.data.duplicate && marketplaceEvents.length === 1,
);

const cancelledMarketplace = await importShopeeOrder({
  ...marketplaceInput,
  orderSn: "SHP-EVENT-CANCELLED",
  status: "CANCELLED",
});
const cancelledMarketplaceEvents = cancelledMarketplace.ok
  ? await eventsFor("order", cancelledMarketplace.data.orderId)
  : [];
ok("cancelled marketplace import emits no invoice event", cancelledMarketplaceEvents.length === 0);

const sourceSale = await createOrderForUser(actor.id, {
  mode: "sale",
  clientId: "event-exchange-source",
  customerId: customer.id,
  warehouseId: warehouse.id,
  items: [{ productId: product.id, unitName: "cái", quantity: 1 }],
  payment: { method: "cash", amount: 100 },
});
const [sourceItem] = sourceSale.ok
  ? await db.select().from(orderItems).where(eq(orderItems.orderId, sourceSale.data.id)).limit(1)
  : [];
const exchangeInput = sourceSale.ok && sourceItem
  ? {
      orderId: sourceSale.data.id,
      clientId: "event-exchange-1",
      reason: "Size exchange",
      refundMethod: "cash",
      items: [{ orderItemId: sourceItem.id, quantity: 1, restock: true }],
      exchangeItems: [{ productId: product.id, unitName: "cái", quantity: 1 }],
      settlementMethod: "cash",
    }
  : null;
const exchange = exchangeInput
  ? await createExchangeForUser(actor.id, exchangeInput)
  : { ok: false, error: "exchange setup failed" };
const exchangeEvents = exchange.ok ? await eventsFor("order", exchange.data.exchangeOrderId) : [];
ok(
  "exchange order emits invoice event instead of debt event",
  exchange.ok
    && exchangeEvents.filter((event) => event.category === "invoiceCreated").length === 1
    && exchangeEvents.filter((event) => event.category === "debtChanged").length === 0,
  exchange.ok ? JSON.stringify(exchangeEvents) : exchange.error,
);
const publicationsBeforeExchangeReplay = publishedEventIds.length;
const exchangeReplay = exchangeInput
  ? await createExchangeForUser(actor.id, exchangeInput)
  : { ok: false, error: "exchange setup failed" };
const exchangeEventsAfterReplay = exchange.ok
  ? await eventsFor("order", exchange.data.exchangeOrderId)
  : [];
ok(
  "exchange replay returns early without duplicate event or publication",
  exchange.ok
    && exchangeReplay.ok
    && exchangeReplay.data.exchangeOrderId === exchange.data.exchangeOrderId
    && exchangeEventsAfterReplay.length === 1
    && publishedEventIds.length === publicationsBeforeExchangeReplay,
  JSON.stringify({ exchange, exchangeReplay, exchangeEventsAfterReplay, publishedEventIds }),
);

const purchase = await createPurchase({
  supplierId: supplier.id,
  warehouseId: warehouse.id,
  amountPaid: 40,
  items: [{ productId: product.id, quantity: 1, unitCost: 100, discount: 0 }],
});
const purchaseEvents = purchase.ok ? await eventsFor("purchase", purchase.data.id) : [];
const purchaseEvent = purchaseEvents.find((event) => event.category === "purchaseReceived");
ok("received purchase emits purchase event", purchaseEvent?.category === "purchaseReceived");
ok(
  "purchase event absorbs supplier debt delta",
  purchaseEvent?.metadata?.debtDelta === "60.00"
    && purchaseEvents.filter((event) => event.category === "debtChanged").length === 0,
);

const [draftPurchase] = await db.insert(purchaseOrders).values({
  code: "PN-DRAFT-EVENT",
  supplierId: supplier.id,
  warehouseId: warehouse.id,
  status: "draft",
}).returning();
const draftEvents = await eventsFor("purchase", draftPurchase.id);
ok("draft purchase emits no event", draftEvents.length === 0);
const receivedDraft = await updatePurchase({
  id: draftPurchase.id,
  supplierId: supplier.id,
  warehouseId: warehouse.id,
  amountPaid: 0,
  items: [{ productId: product.id, quantity: 1, unitCost: 80, discount: 0 }],
});
const receivedDraftEvents = await eventsFor("purchase", draftPurchase.id);
ok(
  "draft to received purchase emits one purchase event",
  receivedDraft.ok
    && receivedDraftEvents.filter((event) => event.category === "purchaseReceived").length === 1
    && receivedDraftEvents.filter((event) => event.category === "debtChanged").length === 0,
);

const repeatEditPurchase = await createPurchase({
  supplierId: supplier.id,
  warehouseId: warehouse.id,
  amountPaid: 60,
  items: [{ productId: product.id, quantity: 1, unitCost: 120, discount: 0 }],
});
const repeatEditOne = repeatEditPurchase.ok
  ? await updatePurchase({
      id: repeatEditPurchase.data.id,
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      amountPaid: 40,
      items: [{ productId: product.id, quantity: 1, unitCost: 120, discount: 0 }],
    })
  : { ok: false, error: "repeat edit setup failed" };
const repeatEditTwo = repeatEditPurchase.ok
  ? await updatePurchase({
      id: repeatEditPurchase.data.id,
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      amountPaid: 20,
      items: [{ productId: product.id, quantity: 1, unitCost: 120, discount: 0 }],
    })
  : { ok: false, error: "repeat edit setup failed" };
const repeatEditPrefix = repeatEditPurchase.ok
  ? `debt-changed:supplier:${supplier.id}:purchase_edit:${repeatEditPurchase.data.id}:`
  : "";
const repeatedEditEvents = (await db.select().from(notificationEvents))
  .filter((event) => event.eventKey.startsWith(repeatEditPrefix));
const committedTimestampPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const repeatEditOneUpdatedAt = repeatEditOne.ok ? repeatEditOne.data?.updatedAt : undefined;
const repeatEditTwoUpdatedAt = repeatEditTwo.ok ? repeatEditTwo.data?.updatedAt : undefined;
ok(
  "two committed debt-changing edits emit two deterministic purchase edit events",
  repeatEditOne.ok
    && repeatEditTwo.ok
    && typeof repeatEditOneUpdatedAt === "string"
    && typeof repeatEditTwoUpdatedAt === "string"
    && committedTimestampPattern.test(repeatEditOneUpdatedAt)
    && committedTimestampPattern.test(repeatEditTwoUpdatedAt)
    && repeatEditOneUpdatedAt !== repeatEditTwoUpdatedAt
    && repeatedEditEvents.length === 2
    && new Set(repeatedEditEvents.map((event) => event.eventKey)).size === 2
    && repeatedEditEvents.every((event) => event.eventKey.length <= 200)
    && repeatedEditEvents.some((event) => event.eventKey.endsWith(`:${repeatEditOneUpdatedAt}`))
    && repeatedEditEvents.some((event) => event.eventKey.endsWith(`:${repeatEditTwoUpdatedAt}`)),
  JSON.stringify({
    repeatEditOneUpdatedAt,
    repeatEditTwoUpdatedAt,
    eventKeys: repeatedEditEvents.map((event) => event.eventKey),
  }),
);
const noOpEditReplay = repeatEditPurchase.ok
  ? await updatePurchase({
      id: repeatEditPurchase.data.id,
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      amountPaid: 20,
      items: [{ productId: product.id, quantity: 1, unitCost: 120, discount: 0 }],
    })
  : { ok: false, error: "repeat edit setup failed" };
const repeatedEditEventsAfterNoOp = (await db.select().from(notificationEvents))
  .filter((event) => event.eventKey.startsWith(repeatEditPrefix));
ok(
  "no-op purchase edit replay emits no additional event",
  noOpEditReplay.ok && repeatedEditEventsAfterNoOp.length === 2,
  JSON.stringify(repeatedEditEventsAfterNoOp.map((event) => event.eventKey)),
);

const cancellableSale = await createOrderForUser(actor.id, {
  mode: "sale",
  clientId: "event-order-cancel",
  customerId: customer.id,
  warehouseId: warehouse.id,
  items: [{ productId: product.id, unitName: "cái", quantity: 1 }],
  payment: { method: "credit", amount: 0 },
});
const cancelledSale = cancellableSale.ok
  ? await cancelOrderForUser(actor.id, cancellableSale.data.id)
  : { ok: false, error: "sale setup failed" };
const cancelDebtEvents = cancellableSale.ok
  ? await db.select().from(notificationEvents).where(eq(
      notificationEvents.eventKey,
      `debt-changed:customer:${customer.id}:order_cancel:${cancellableSale.data.id}`,
    ))
  : [];
ok(
  "order cancellation emits signed standalone customer debt event",
  cancelledSale.ok
    && cancelDebtEvents.length === 1
    && cancelDebtEvents[0].metadata?.delta === -100,
  cancelledSale.ok ? JSON.stringify(cancelDebtEvents) : cancelledSale.error,
);

const editedPurchase = purchase.ok
  ? await updatePurchase({
      id: purchase.data.id,
      supplierId: supplier.id,
      warehouseId: warehouse.id,
      amountPaid: 20,
      items: [{ productId: product.id, quantity: 1, unitCost: 100, discount: 0 }],
    })
  : { ok: false, error: "purchase setup failed" };
const sameSupplierEditEvents = purchase.ok
  ? (await db.select().from(notificationEvents)).filter((event) => event.eventKey.startsWith(
      `debt-changed:supplier:${supplier.id}:purchase_edit:${purchase.data.id}:`,
    ))
  : [];
ok(
  "received purchase edit emits signed standalone supplier debt event",
  editedPurchase.ok
    && sameSupplierEditEvents.length === 1
    && sameSupplierEditEvents[0].metadata?.delta === 20,
  editedPurchase.ok ? JSON.stringify(sameSupplierEditEvents) : editedPurchase.error,
);

const movedPurchase = purchase.ok
  ? await updatePurchase({
      id: purchase.data.id,
      supplierId: otherSupplier.id,
      warehouseId: warehouse.id,
      amountPaid: 30,
      items: [{ productId: product.id, quantity: 1, unitCost: 100, discount: 0 }],
    })
  : { ok: false, error: "purchase setup failed" };
const supplierMoveEvents = purchase.ok
  ? (await db.select().from(notificationEvents)).filter((event) => event.eventKey.startsWith(
      `debt-changed:supplier:${otherSupplier.id}:purchase_edit:${purchase.data.id}:`,
    ))
  : [];
ok(
  "supplier move emits one net debt event with both ledger adjustments",
  movedPurchase.ok
    && supplierMoveEvents.length === 1
    && supplierMoveEvents[0].metadata?.delta === -10
    && supplierMoveEvents[0].metadata?.relatedAdjustments?.length === 2
    && supplierMoveEvents[0].metadata.relatedAdjustments[0].entityType === "supplier"
    && supplierMoveEvents[0].metadata.relatedAdjustments[0].entityId === supplier.id
    && supplierMoveEvents[0].metadata.relatedAdjustments[0].delta === -80
    && supplierMoveEvents[0].metadata.relatedAdjustments[1].entityType === "supplier"
    && supplierMoveEvents[0].metadata.relatedAdjustments[1].entityId === otherSupplier.id
    && supplierMoveEvents[0].metadata.relatedAdjustments[1].delta === 70,
  movedPurchase.ok ? JSON.stringify(supplierMoveEvents) : movedPurchase.error,
);

const cancelledPurchase = purchase.ok
  ? await cancelPurchase(purchase.data.id)
  : { ok: false, error: "purchase setup failed" };
const purchaseCancelEvents = purchase.ok
  ? await db.select().from(notificationEvents).where(eq(
      notificationEvents.eventKey,
      `debt-changed:supplier:${otherSupplier.id}:purchase_cancel:${purchase.data.id}`,
    ))
  : [];
ok(
  "purchase cancellation emits signed standalone supplier debt event",
  cancelledPurchase.ok
    && purchaseCancelEvents.length === 1
    && purchaseCancelEvents[0].metadata?.delta === -70,
  cancelledPurchase.ok ? JSON.stringify(purchaseCancelEvents) : cancelledPurchase.error,
);

await db.update(suppliers).set({ currentDebt: "100.00" }).where(eq(suppliers.id, supplier.id));
const purchaseReturn = await createPurchaseReturn({
  supplierId: supplier.id,
  warehouseId: warehouse.id,
  debtAmount: 30,
  refundAmount: 0,
  items: [{
    productId: product.id,
    quantity: 1,
    unitCost: 30,
    returnUnitCost: 30,
  }],
});
const purchaseReturnEvents = purchaseReturn.ok
  ? await db.select().from(notificationEvents).where(eq(
      notificationEvents.eventKey,
      `debt-changed:supplier:${supplier.id}:purchase_return:${purchaseReturn.data.id}`,
    ))
  : [];
ok(
  "purchase return emits signed standalone supplier debt event",
  purchaseReturn.ok
    && purchaseReturnEvents.length === 1
    && purchaseReturnEvents[0].metadata?.delta === -30,
  purchaseReturn.ok ? JSON.stringify(purchaseReturnEvents) : purchaseReturn.error,
);

const returnableSale = await createOrderForUser(actor.id, {
  mode: "sale",
  clientId: "event-sale-return",
  customerId: customer.id,
  warehouseId: warehouse.id,
  items: [{ productId: product.id, unitName: "cái", quantity: 1 }],
  payment: { method: "credit", amount: 0 },
});
const [returnableItem] = returnableSale.ok
  ? await db.select().from(orderItems).where(eq(orderItems.orderId, returnableSale.data.id)).limit(1)
  : [];
const customerReturnInput = returnableSale.ok && returnableItem
  ? {
      orderId: returnableSale.data.id,
      clientId: "event-sale-return-1",
      reason: "Customer return",
      refundMethod: "debt_deduct",
      items: [{ orderItemId: returnableItem.id, quantity: 1, restock: true }],
    }
  : null;
const customerReturn = customerReturnInput
  ? await createReturnForUser(actor.id, customerReturnInput)
  : { ok: false, error: "return setup failed" };
const saleReturnEvents = customerReturn.ok
  ? await db.select().from(notificationEvents).where(eq(
      notificationEvents.eventKey,
      `debt-changed:customer:${customer.id}:sale_return:${customerReturn.data.id}`,
    ))
  : [];
ok(
  "customer return emits signed standalone debt event",
  customerReturn.ok
    && saleReturnEvents.length === 1
    && saleReturnEvents[0].metadata?.delta === -100,
  customerReturn.ok ? JSON.stringify(saleReturnEvents) : customerReturn.error,
);
const publicationsBeforeCustomerReturnReplay = publishedEventIds.length;
const customerReturnReplay = customerReturnInput
  ? await createReturnForUser(actor.id, customerReturnInput)
  : { ok: false, error: "return setup failed" };
const saleReturnEventsAfterReplay = customerReturn.ok
  ? await db.select().from(notificationEvents).where(eq(
      notificationEvents.eventKey,
      `debt-changed:customer:${customer.id}:sale_return:${customerReturn.data.id}`,
    ))
  : [];
ok(
  "customer return replay returns early without duplicate event or publication",
  customerReturn.ok
    && customerReturnReplay.ok
    && customerReturnReplay.data.id === customerReturn.data.id
    && saleReturnEventsAfterReplay.length === 1
    && publishedEventIds.length === publicationsBeforeCustomerReturnReplay,
  JSON.stringify({
    customerReturn,
    customerReturnReplay,
    saleReturnEventsAfterReplay,
    publishedEventIds,
  }),
);

const posReturnableSale = await createOrderForUser(actor.id, {
  mode: "sale",
  clientId: "event-pos-sale-return",
  customerId: customer.id,
  warehouseId: warehouse.id,
  items: [{ productId: product.id, unitName: "cái", quantity: 1 }],
  payment: { method: "credit", amount: 0 },
});
const posCustomerReturn = posReturnableSale.ok
  ? await createPosReturn({
      orderId: posReturnableSale.data.id,
      customerId: customer.id,
      warehouseId: warehouse.id,
      reason: "POS customer return",
      refundMethod: "debt_deduct",
      items: [{
        productId: product.id,
        unitName: "cái",
        quantity: 1,
        restock: true,
      }],
    })
  : { ok: false, error: "POS return setup failed" };
const posSaleReturnEvents = posCustomerReturn.ok
  ? await db.select().from(notificationEvents).where(eq(
      notificationEvents.eventKey,
      `debt-changed:customer:${customer.id}:sale_return:${posCustomerReturn.data.id}`,
    ))
  : [];
ok(
  "POS customer return emits signed standalone debt event",
  posCustomerReturn.ok
    && posSaleReturnEvents.length === 1
    && posSaleReturnEvents[0].metadata?.delta === -100,
  posCustomerReturn.ok ? JSON.stringify(posSaleReturnEvents) : posCustomerReturn.error,
);

const payableSale = await createOrderForUser(actor.id, {
  mode: "sale",
  clientId: "event-manual-payment",
  customerId: customer.id,
  warehouseId: warehouse.id,
  items: [{ productId: product.id, unitName: "cái", quantity: 1 }],
  payment: { method: "credit", amount: 0 },
});
const manualPaymentRequest = payableSale.ok
  ? {
      orderId: payableSale.data.id,
      amount: 50,
      method: "card",
      clientRequestId: "event-manual-payment-1",
    }
  : null;
const publicationsBeforeManualPayment = publishedEventIds.length;
const manualPayment = manualPaymentRequest
  ? await addPaymentForUser(actor.id, manualPaymentRequest)
  : { ok: false, error: "manual payment setup failed" };
const manualPaymentReplay = manualPaymentRequest
  ? await addPaymentForUser(actor.id, manualPaymentRequest)
  : { ok: false, error: "manual payment setup failed" };
const manualPaymentEvents = await db.select().from(notificationEvents).where(eq(
  notificationEvents.eventKey,
  `debt-changed:customer:${customer.id}:manual_payment:event-manual-payment-1`,
));
ok(
  "manual payment wrapper publishes created debt event once after commit",
  manualPayment.ok
    && manualPaymentReplay.ok
    && manualPaymentEvents.length === 1
    && publishedEventIds.length === publicationsBeforeManualPayment + 1
    && publishedEventIds.at(-1) === manualPaymentEvents[0].id
    && publicationDepths.at(-1) === 0,
  JSON.stringify({
    manualPayment,
    manualPaymentReplay,
    eventId: manualPaymentEvents[0]?.id,
    publishedEventIds,
  }),
);

const beforeInvalidBatchEvents = (await db.select().from(notificationEvents)).length;
const beforeInvalidBatchPurchases = (await db.select().from(purchaseOrders)).length;
const invalidBatch = await createPurchase({
  supplierId: supplier.id,
  warehouseId: warehouse.id,
  amountPaid: 0,
  items: [{ productId: trackedProduct.id, quantity: 1, unitCost: 100, discount: 0 }],
});
ok("invalid batch receipt fails", !invalidBatch.ok && invalidBatch.error === "purchases.errors.batchRequired");
ok(
  "invalid batch receipt rolls back purchase and event",
  (await db.select().from(notificationEvents)).length === beforeInvalidBatchEvents
    && (await db.select().from(purchaseOrders)).length === beforeInvalidBatchPurchases,
);

const beforeInsufficientEvents = (await db.select().from(notificationEvents)).length;
const insufficientSale = await createOrderForUser(actor.id, {
  mode: "sale",
  clientId: "event-insufficient-batch",
  customerId: customer.id,
  warehouseId: warehouse.id,
  items: [{ productId: trackedProduct.id, unitName: "cái", quantity: 1 }],
  payment: { method: "credit", amount: 0 },
});
ok("insufficient stock sale fails", !insufficientSale.ok && insufficientSale.error === "pos.errors.insufficientStock");
ok(
  "insufficient stock rolls back invoice event",
  (await db.select().from(notificationEvents)).length === beforeInsufficientEvents,
);

ok(
  "all queue publications happen after business commit",
  publicationDepths.length > 0 && publicationDepths.every((depth) => depth === 0),
  JSON.stringify(publicationDepths),
);
ok(
  "only newly created events are published once",
  publishedEventIds.length === new Set(publishedEventIds).size,
  JSON.stringify(publishedEventIds),
);

await client.close();
if (failed > 0) {
  console.error(`notification business events: ${passed} passed, ${failed} failed`);
  process.exitCode = 1;
} else {
  console.log(`notification business events: ${passed} passed, 0 failed`);
}
