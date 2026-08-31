import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, eq } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const {
  createKiotVietDataSyncAuditRepository,
  createKiotVietDataSyncTransaction,
} = await import(`${projectRoot}/src/lib/kiotviet/data-sync-database.ts`);
const {
  applyKiotVietTypedPhasePlan,
} = await import(`${projectRoot}/src/lib/kiotviet/data-sync-apply.ts`);
const {
  applyKiotVietPhaseWithDatabase,
  loadKiotVietPlanningStateFromDatabase,
  planKiotVietBundle,
} = await import(`${projectRoot}/src/scripts/sync-kiotviet-data.ts`);
const {
  assertKiotVietHistoryInvariants,
  createEmptyKiotVietInvariantSnapshot,
  executeKiotVietDataSyncPhase,
  parseKiotVietDataSyncArgs,
} = await import(`${projectRoot}/src/lib/kiotviet/data-sync-runner.ts`);

const STORE_ID = "00000000-0000-4000-8000-000000000001";
const OTHER_STORE_ID = "00000000-0000-4000-8000-000000000012";
const SOURCE_SHA = "a".repeat(64);
const BUNDLE_SHA = "b".repeat(64);
const client = new PGlite();
const database = drizzle(client, { schema });

function createAuditRepository(storeId = STORE_ID, expectedStoreSlug = "hai-dang") {
  return createKiotVietDataSyncAuditRepository({
    storeId,
    expectedStoreSlug,
    runInTransaction: (work) => database.transaction(work),
  });
}

async function applySqlFile(path) {
  const contents = readFileSync(path, "utf8");
  for (const statement of contents
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) {
      await client.exec(statement);
    }
  }
}

beforeAll(async () => {
  await client.exec("create role anon; create role authenticated;");
  for (const name of readdirSync(`${projectRoot}/drizzle`)
    .filter((entry) => entry.endsWith(".sql"))
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${name}`);
  }
  await database.insert(schema.stores).values({ id: OTHER_STORE_ID, slug: "other-store" });
});

afterAll(async () => client.close());

describe("KiotViet remaining-data apply guard", () => {
  test("is dry-run by default and rejects unsafe apply arguments", () => {
    expect(parseKiotVietDataSyncArgs([])).toEqual({
      directory: "kiotviet_data",
      phase: "all",
      storeSlug: null,
      apply: false,
      reviewedSourceSha256: null,
    });
    expect(parseKiotVietDataSyncArgs([
      "/tmp/kiot",
      "--store=hai-dang",
      "--phase=sales",
    ])).toEqual({
      directory: "/tmp/kiot",
      phase: "sales",
      storeSlug: "hai-dang",
      apply: false,
      reviewedSourceSha256: null,
    });
    expect(() => parseKiotVietDataSyncArgs([
      "/tmp/kiot",
      "--apply",
      "--store=hai-dang",
      "--phase=all",
      `--source-sha256=${SOURCE_SHA}`,
    ])).toThrow("--phase=all is dry-run only");
    expect(() => parseKiotVietDataSyncArgs([
      "/tmp/kiot",
      "--apply",
      "--store=other-store",
      "--phase=sales",
      `--source-sha256=${SOURCE_SHA}`,
    ])).toThrow("--apply requires --store=hai-dang");
    expect(() => parseKiotVietDataSyncArgs([
      "/tmp/kiot",
      "--apply",
      "--store=hai-dang",
      "--phase=sales",
    ])).toThrow("--apply requires --source-sha256");
  });

  test("checks the reviewed hash before opening a transaction", async () => {
    let transactions = 0;
    await expect(executeKiotVietDataSyncPhase({
      apply: true,
      phase: "sales",
      storeSlug: "hai-dang",
      reviewedSourceSha256: "c".repeat(64),
      source: {
        fileName: "sales.xlsx",
        sha256: SOURCE_SHA,
        bundleSha256: BUNDLE_SHA,
        rowCount: 1,
        documentCount: 1,
      },
      audit: {
        async startRun() {
          throw new Error("audit must not run");
        },
        async failRun() {
          throw new Error("audit must not run");
        },
      },
      runInTransaction: async () => {
        transactions += 1;
      },
      work: async () => ({}),
    })).rejects.toThrow("reviewed source SHA-256 does not match");
    expect(transactions).toBe(0);
  });

  test("does not open a transaction in dry-run mode", async () => {
    let transactions = 0;
    const result = await executeKiotVietDataSyncPhase({
      apply: false,
      phase: "sales",
      storeSlug: "hai-dang",
      reviewedSourceSha256: null,
      source: {
        fileName: "sales.xlsx",
        sha256: SOURCE_SHA,
        bundleSha256: BUNDLE_SHA,
        rowCount: 1,
        documentCount: 1,
      },
      audit: {
        async startRun() {
          throw new Error("audit must not run");
        },
        async failRun() {
          throw new Error("audit must not run");
        },
      },
      runInTransaction: async () => {
        transactions += 1;
      },
      work: async () => ({ created: 1 }),
    });
    expect(result).toEqual({ status: "dry-run", summary: null });
    expect(transactions).toBe(0);
  });
});

describe("KiotViet invariant harness", () => {
  test("allows only the selected partner master snapshot to change", () => {
    const before = createEmptyKiotVietInvariantSnapshot();
    const customerAfter = structuredClone(before);
    customerAfter.customers.currentDebt = "100";
    expect(() => assertKiotVietHistoryInvariants("customers", before, customerAfter))
      .not.toThrow();
    expect(() => assertKiotVietHistoryInvariants("sales", before, customerAfter))
      .toThrow("customers.currentDebt changed from 0 to 100");

    const stockAfter = structuredClone(before);
    stockAfter.stockLevels.reserved = "2";
    expect(() => assertKiotVietHistoryInvariants("customers", before, stockAfter))
      .toThrow("stockLevels.reserved changed from 0 to 2");
  });

  test("writes the audit row and aborts before completion on invariant drift", async () => {
    const calls = [];
    const before = createEmptyKiotVietInvariantSnapshot();
    const after = structuredClone(before);
    after.cashTransactions.outAmount = "1";
    let snapshotCall = 0;
    const transaction = {
      async captureInvariants() {
        snapshotCall += 1;
        return snapshotCall === 1 ? before : after;
      },
      async completeRun(runId, summary) {
        calls.push(["completeRun", runId, summary]);
      },
    };
    const audit = {
      async startRun(input) {
        calls.push(["startRun", input.phase, input.sourceSha256]);
        return "run-id";
      },
      async failRun(runId, failure) {
        calls.push(["failRun", runId, failure.status, failure.errorDetails.message]);
      },
    };

    await expect(executeKiotVietDataSyncPhase({
      apply: true,
      phase: "purchases",
      storeSlug: "hai-dang",
      reviewedSourceSha256: SOURCE_SHA,
      source: {
        fileName: "purchases.xlsx",
        sha256: SOURCE_SHA,
        bundleSha256: BUNDLE_SHA,
        rowCount: 2,
        documentCount: 1,
      },
      audit,
      runInTransaction: (work) => work(transaction),
      work: async (_transaction, runId) => ({ runId, created: 1 }),
    })).rejects.toThrow("cashTransactions.outAmount changed from 0 to 1");
    expect(calls).toEqual([
      ["startRun", "purchases", SOURCE_SHA],
      ["failRun", "run-id", "rolled_back", "KiotViet invariant violation: cashTransactions.outAmount changed from 0 to 1"],
    ]);
  });
});

describe("KiotViet store-scoped database adapter", () => {
  test("applies a customer create to the real transaction and creates its source mapping", async () => {
    const runId = await createAuditRepository().startRun({
      phase: "customers",
      sourceFileName: "customers.xlsx",
      sourceSha256: SOURCE_SHA,
      bundleSha256: BUNDLE_SHA,
      sourceRows: 1,
      sourceDocuments: 1,
    });

    await database.transaction(async (rawTransaction) => {
      const syncTransaction = await createKiotVietDataSyncTransaction({
        transaction: rawTransaction,
        storeId: STORE_ID,
        expectedStoreSlug: "hai-dang",
      });
      await applyKiotVietTypedPhasePlan({
        transaction: rawTransaction,
        syncTransaction,
        storeId: STORE_ID,
        runId,
        sourceSha256: SOURCE_SHA,
        plan: {
          phase: "customers",
          summary: { created: 1 },
          blockers: [],
          typedPlan: {
            customers: [],
            entityPlan: { creates: [], adopts: [], updates: [], unchanged: [], preserves: [], conflicts: [] },
            inactivations: [],
            historicalPlaceholders: [],
            sourceTotals: { currentDebt: 25, totalSpent: 100 },
            summary: { created: 1, adopted: 0, updated: 0, unchanged: 0, conflicts: 0, preserved: 0, inactivated: 0, historicalPlaceholders: 0, debtCorrections: 0, totalSpentCorrections: 0 },
            writes: [{
              action: "create",
              externalId: "KH-APPLY",
              customer: { externalId: "KH-APPLY", code: "KH-APPLY", name: "Apply customer", phone: null, email: null, address: null, taxCode: null, note: null, isActive: true, currentDebt: 25, totalSpent: 100, type: "retail" },
            }],
          },
        },
      });
    });

    const [created] = await database.select().from(schema.customers)
      .where(and(eq(schema.customers.storeId, STORE_ID), eq(schema.customers.code, "KH-APPLY")));
    expect(created).toMatchObject({ name: "Apply customer", currentDebt: "25.00", totalSpent: "100.00" });
    const [mapping] = await database.select().from(schema.kiotvietSourceMappings)
      .where(and(
        eq(schema.kiotvietSourceMappings.storeId, STORE_ID),
        eq(schema.kiotvietSourceMappings.entityType, "customer"),
        eq(schema.kiotvietSourceMappings.externalId, "KH-APPLY"),
      ));
    expect(mapping).toMatchObject({ localId: created.id, adoptionMethod: "created", lastSeenRunId: runId });
    await database.delete(schema.kiotvietSourceMappings).where(eq(schema.kiotvietSourceMappings.id, mapping.id));
    await database.delete(schema.customers).where(eq(schema.customers.id, created.id));
    await database.delete(schema.kiotvietSyncRuns).where(eq(schema.kiotvietSyncRuns.id, runId));
  });

  test("adopts an importer-proven historical supplier as inactive with deleted source ownership", async () => {
    const [supplier] = await database.insert(schema.suppliers).values({
      storeId: STORE_ID,
      code: "NCC-HISTORY-APPLY",
      name: "Historical supplier",
      note: "Tạo từ import lịch sử KiotViet",
      isActive: true,
    }).returning({ id: schema.suppliers.id });
    const runId = await createAuditRepository().startRun({
      phase: "suppliers",
      sourceFileName: "suppliers.xlsx",
      sourceSha256: SOURCE_SHA,
      bundleSha256: BUNDLE_SHA,
      sourceRows: 0,
      sourceDocuments: 0,
    });

    await database.transaction(async (rawTransaction) => {
      const syncTransaction = await createKiotVietDataSyncTransaction({
        transaction: rawTransaction,
        storeId: STORE_ID,
        expectedStoreSlug: "hai-dang",
      });
      await applyKiotVietTypedPhasePlan({
        transaction: rawTransaction,
        syncTransaction,
        storeId: STORE_ID,
        runId,
        sourceSha256: SOURCE_SHA,
        plan: {
          phase: "suppliers",
          summary: { inactivated: 1 },
          blockers: [],
          typedPlan: {
            suppliers: [],
            entityPlan: { creates: [], adopts: [], updates: [], unchanged: [], preserves: [], conflicts: [] },
            inactivations: [],
            historicalAdoptions: [{ externalId: "NCC-HISTORY-APPLY", localId: supplier.id }],
            historicalPlaceholders: [],
            unknownSupplierPlaceholder: null,
            sourceTotals: { currentDebt: 0, netPurchases: 0 },
            summary: { created: 0, adopted: 0, updated: 0, unchanged: 0, conflicts: 0, preserved: 0, inactivated: 1, historicalPlaceholders: 0, unknownSupplierPlaceholders: 0, debtCorrections: 0 },
            writes: [{
              action: "historical_adopt",
              externalId: "NCC-HISTORY-APPLY",
              localId: supplier.id,
              supplier: { isActive: false },
            }],
          },
        },
      });
    });

    const [updated] = await database.select().from(schema.suppliers)
      .where(eq(schema.suppliers.id, supplier.id));
    expect(updated.isActive).toBe(false);
    const [mapping] = await database.select().from(schema.kiotvietSourceMappings)
      .where(and(
        eq(schema.kiotvietSourceMappings.storeId, STORE_ID),
        eq(schema.kiotvietSourceMappings.entityType, "supplier"),
        eq(schema.kiotvietSourceMappings.externalId, "NCC-HISTORY-APPLY"),
      ));
    expect(mapping).toMatchObject({
      localId: supplier.id,
      adoptionMethod: "legacy_adopted",
      lastSeenRunId: runId,
    });
    expect(mapping.deletedAt).toBeInstanceOf(Date);

    await database.delete(schema.kiotvietSourceMappings).where(eq(schema.kiotvietSourceMappings.id, mapping.id));
    await database.delete(schema.suppliers).where(eq(schema.suppliers.id, supplier.id));
    await database.delete(schema.kiotvietSyncRuns).where(eq(schema.kiotvietSyncRuns.id, runId));
  });

  test("captures invariants, validates mapping ownership, and preserves mapping identity", async () => {
    const [customer, otherCustomer] = await database.insert(schema.customers).values([
      { storeId: STORE_ID, code: "KH-1", name: "Customer 1", currentDebt: "25", totalSpent: "100" },
      { storeId: OTHER_STORE_ID, code: "KH-X", name: "Other customer" },
    ]).returning({ id: schema.customers.id });
    const runId = await createAuditRepository().startRun({
      phase: "customers",
      sourceFileName: "customers.xlsx",
      sourceSha256: SOURCE_SHA,
      bundleSha256: BUNDLE_SHA,
      sourceRows: 1,
      sourceDocuments: 1,
    });

    await database.transaction(async (rawTransaction) => {
      const transaction = await createKiotVietDataSyncTransaction({
        transaction: rawTransaction,
        storeId: STORE_ID,
        expectedStoreSlug: "hai-dang",
      });
      const snapshot = await transaction.captureInvariants();
      expect(snapshot.customers).toMatchObject({ rows: 1, currentDebt: "25.00", totalSpent: "100.00" });
      expect(snapshot.customers.fingerprint).toMatch(/^[0-9a-f]{32}$/);
      expect(snapshot.stockLevels).toMatchObject({ rows: 0, quantity: "0", reserved: "0" });
      expect(snapshot.stockLevels.fingerprint).toMatch(/^[0-9a-f]{32}$/);

      await expect(transaction.upsertSourceMapping({
        entityType: "customer",
        externalId: "KH-X",
        localId: otherCustomer.id,
        sourceSha256: SOURCE_SHA,
        adoptionMethod: "legacy_adopted",
        lastSeenRunId: runId,
        deletedAt: null,
      })).rejects.toThrow("does not belong to store");

      const mappingId = await transaction.upsertSourceMapping({
        entityType: "customer",
        externalId: "KH-1",
        localId: customer.id,
        sourceSha256: SOURCE_SHA,
        adoptionMethod: "legacy_adopted",
        lastSeenRunId: runId,
        deletedAt: null,
      });
      expect(await transaction.upsertSourceMapping({
        entityType: "customer",
        externalId: "KH-1",
        localId: customer.id,
        sourceSha256: SOURCE_SHA,
        adoptionMethod: "mapped",
        lastSeenRunId: runId,
        deletedAt: null,
      })).toBe(mappingId);
      expect(await transaction.loadSourceMappings("customer")).toEqual([expect.objectContaining({
        id: mappingId,
        externalId: "KH-1",
        localId: customer.id,
        adoptionMethod: "legacy_adopted",
      })]);

      const [sale] = await rawTransaction.insert(schema.orders).values({
        storeId: STORE_ID,
        code: "HD-MAPPING-TYPE",
        documentType: "sale",
      }).returning({ id: schema.orders.id });
      await expect(transaction.upsertSourceMapping({
        entityType: "booking",
        externalId: "DH-MAPPING-TYPE",
        localId: sale.id,
        sourceSha256: SOURCE_SHA,
        adoptionMethod: "legacy_adopted",
        lastSeenRunId: runId,
        deletedAt: null,
      })).rejects.toThrow("does not belong to store");
      await transaction.completeRun(runId, { created: 0, adopted: 1 });
    });

    const [run] = await database.select().from(schema.kiotvietSyncRuns)
      .where(and(
        eq(schema.kiotvietSyncRuns.storeId, STORE_ID),
        eq(schema.kiotvietSyncRuns.phase, "customers"),
      ));
    expect(run).toMatchObject({ status: "completed", sourceSha256: SOURCE_SHA });
    expect(run.completedAt).toBeInstanceOf(Date);
  });

  test("binds the expected slug to the adapter store id", async () => {
    await expect(database.transaction(async (rawTransaction) => {
      await createKiotVietDataSyncTransaction({
        transaction: rawTransaction,
        storeId: OTHER_STORE_ID,
        expectedStoreSlug: "hai-dang",
      });
    })).rejects.toThrow("does not match expected slug hai-dang");
    await expect(createAuditRepository(OTHER_STORE_ID, "hai-dang").startRun({
      phase: "customers",
      sourceFileName: "wrong-store.xlsx",
      sourceSha256: SOURCE_SHA,
      bundleSha256: BUNDLE_SHA,
      sourceRows: 1,
      sourceDocuments: 1,
    })).rejects.toThrow("does not match expected slug hai-dang");
  });

  test("detects compensating per-row changes even when counts and totals stay equal", async () => {
    const [left, right] = await database.insert(schema.customers).values([
      { storeId: STORE_ID, code: "KH-HASH-LEFT", name: "Hash left", currentDebt: "10" },
      { storeId: STORE_ID, code: "KH-HASH-RIGHT", name: "Hash right", currentDebt: "20" },
    ]).returning({ id: schema.customers.id });

    await expect(database.transaction(async (rawTransaction) => {
      const transaction = await createKiotVietDataSyncTransaction({
        transaction: rawTransaction,
        storeId: STORE_ID,
        expectedStoreSlug: "hai-dang",
      });
      const before = await transaction.captureInvariants();
      await rawTransaction.update(schema.customers).set({ currentDebt: "11" })
        .where(eq(schema.customers.id, left.id));
      await rawTransaction.update(schema.customers).set({ currentDebt: "19" })
        .where(eq(schema.customers.id, right.id));
      const after = await transaction.captureInvariants();
      expect(after.customers.currentDebt).toBe(before.customers.currentDebt);
      expect(after.customers.fingerprint).not.toBe(before.customers.fingerprint);
      assertKiotVietHistoryInvariants("sales", before, after);
    })).rejects.toThrow("customers.fingerprint changed");
  });

  test("rolls back audit and mapping writes together", async () => {
    const [customer] = await database.insert(schema.customers).values({
      storeId: STORE_ID,
      code: "KH-ROLLBACK",
      name: "Rollback customer",
    }).returning({ id: schema.customers.id });

    await expect(executeKiotVietDataSyncPhase({
      apply: true,
      phase: "sales",
      storeSlug: "hai-dang",
      reviewedSourceSha256: SOURCE_SHA,
      source: {
        fileName: "sales-rollback.xlsx",
        sha256: SOURCE_SHA,
        bundleSha256: BUNDLE_SHA,
        rowCount: 1,
        documentCount: 1,
      },
      audit: createAuditRepository(),
      runInTransaction: (work) => database.transaction(async (rawTransaction) => work(
        await createKiotVietDataSyncTransaction({
          transaction: rawTransaction,
          storeId: STORE_ID,
          expectedStoreSlug: "hai-dang",
        }),
      )),
      work: async (transaction, runId) => {
        await transaction.upsertSourceMapping({
          entityType: "customer",
          externalId: "KH-ROLLBACK",
          localId: customer.id,
          sourceSha256: SOURCE_SHA,
          adoptionMethod: "legacy_adopted",
          lastSeenRunId: runId,
          deletedAt: null,
        });
        throw new Error("forced rollback");
      },
    })).rejects.toThrow("forced rollback");

    expect(await database.select().from(schema.kiotvietSourceMappings)
      .where(eq(schema.kiotvietSourceMappings.externalId, "KH-ROLLBACK"))).toHaveLength(0);
    const [failedRun] = await database.select().from(schema.kiotvietSyncRuns)
      .where(eq(schema.kiotvietSyncRuns.sourceFileName, "sales-rollback.xlsx"));
    expect(failedRun).toMatchObject({
      status: "failed",
      errorDetails: { message: "forced rollback" },
    });
    expect(failedRun.completedAt).toBeInstanceOf(Date);
  });

  test("applies source-owned creates for every document phase without operational side effects", async () => {
    let [warehouse] = await database.select().from(schema.warehouses)
      .where(and(eq(schema.warehouses.storeId, STORE_ID), eq(schema.warehouses.isDefault, true)));
    if (!warehouse) {
      [warehouse] = await database.insert(schema.warehouses).values({
        storeId: STORE_ID,
        name: "Apply default warehouse",
        isDefault: true,
      }).returning();
    }
    expect(warehouse).toBeDefined();
    const [product] = await database.insert(schema.products).values({
      storeId: STORE_ID,
      sku: "SKU-APPLY-ALL",
      name: "Apply product",
      baseUnit: "Cái",
    }).returning({ id: schema.products.id });
    const [customer] = await database.insert(schema.customers).values({
      storeId: STORE_ID,
      code: "KH-APPLY-ALL",
      name: "Apply customer all",
    }).returning({ id: schema.customers.id });
    const emptyEntityPlan = { creates: [], adopts: [], updates: [], unchanged: [], preserves: [], conflicts: [] };
    async function apply(phase, typedPlan) {
      const runId = await createAuditRepository().startRun({
        phase,
        sourceFileName: `${phase}.xlsx`,
        sourceSha256: SOURCE_SHA,
        bundleSha256: BUNDLE_SHA,
        sourceRows: 1,
        sourceDocuments: 1,
      });
      await database.transaction(async (rawTransaction) => {
        const syncTransaction = await createKiotVietDataSyncTransaction({
          transaction: rawTransaction,
          storeId: STORE_ID,
          expectedStoreSlug: "hai-dang",
        });
        await applyKiotVietTypedPhasePlan({
          transaction: rawTransaction,
          syncTransaction,
          storeId: STORE_ID,
          runId,
          sourceSha256: SOURCE_SHA,
          plan: { phase, summary: { creates: 1 }, blockers: [], typedPlan },
        });
      });
    }

    const line = {
      externalId: "DOC-APPLY-ALL|SKU-APPLY-ALL|cái|1",
      productId: product.id,
      sourceSku: "SKU-APPLY-ALL",
      productName: "Apply product",
      unitName: "Cái",
      unitMultiplier: 1,
      quantity: 2,
      unitPrice: 10,
      discount: 0,
      total: 20,
      note: null,
    };
    const orderBase = {
      status: "completed",
      paymentStatus: "paid",
      customerId: customer.id,
      createdAt: new Date("2026-01-01T00:00:00Z"),
      subtotal: 20,
      discount: 0,
      tax: 0,
      shippingFee: 0,
      total: 20,
      amountPaid: 20,
      note: null,
    };
    await apply("product-references", { summary: {}, resolutions: [], blockers: [] });
    await apply("suppliers", {
      suppliers: [], entityPlan: emptyEntityPlan, inactivations: [], historicalPlaceholders: [],
      unknownSupplierPlaceholder: null, sourceTotals: { currentDebt: 0, netPurchases: 0 }, blockers: [], summary: {},
      writes: [{ action: "create", externalId: "NCC-APPLY-ALL", supplier: {
        code: "NCC-APPLY-ALL", name: "Apply supplier all", phone: null, email: null, address: null,
        taxCode: null, note: null, isActive: true, currentDebt: 0,
      } }],
    });
    const [supplier] = await database.select({ id: schema.suppliers.id }).from(schema.suppliers)
      .where(and(eq(schema.suppliers.storeId, STORE_ID), eq(schema.suppliers.code, "NCC-APPLY-ALL")));
    await apply("bookings", {
      bookings: [], entityPlan: emptyEntityPlan, blockers: [], summary: {},
      writes: [{ action: "create", externalId: "DH-APPLY-ALL", booking: {
        ...orderBase, code: "DH-APPLY-ALL", documentType: "booking", deliveryDate: null,
        lines: [{ action: "create", adoptionMethod: "created", externalId: "DH-APPLY-ALL|SKU-APPLY-ALL|cái|1", line: { ...line, externalId: undefined } }],
        payments: [{ action: "create", adoptionMethod: "created", externalId: "DH-APPLY-ALL|payment|cash|1", payment: { channel: "cash", method: "cash", amount: 20 } }],
        preservedLineIds: [], preservedPaymentIds: [],
      } }],
    });
    await apply("sales", {
      sales: [], entityPlan: emptyEntityPlan, blockers: [], summary: {},
      writes: [{ action: "create", externalId: "HD-APPLY-ALL", sale: {
        ...orderBase, code: "HD-APPLY-ALL", documentType: "sale", sourceOrderId: null,
        lines: [{ action: "create", adoptionMethod: "created", externalId: "HD-APPLY-ALL|SKU-APPLY-ALL|cái|1", line: { ...line, externalId: undefined } }],
        payments: [{ action: "create", adoptionMethod: "created", externalId: "HD-APPLY-ALL|payment|cash|1", payment: { channel: "cash", method: "cash", amount: 20 } }],
        preservedLineIds: [], preservedPaymentIds: [],
      } }],
    });
    const [sale] = await database.select().from(schema.orders)
      .where(and(eq(schema.orders.storeId, STORE_ID), eq(schema.orders.code, "HD-APPLY-ALL")));
    const [saleLine] = await database.select().from(schema.orderItems)
      .where(and(eq(schema.orderItems.storeId, STORE_ID), eq(schema.orderItems.orderId, sale.id)));
    const [booking] = await database.select().from(schema.orders)
      .where(and(eq(schema.orders.storeId, STORE_ID), eq(schema.orders.code, "DH-APPLY-ALL")));
    const [bookingLine] = await database.select().from(schema.orderItems)
      .where(and(eq(schema.orderItems.storeId, STORE_ID), eq(schema.orderItems.orderId, booking.id)));
    const [bookingPayment] = await database.select().from(schema.payments)
      .where(and(eq(schema.payments.storeId, STORE_ID), eq(schema.payments.orderId, booking.id)));
    await database.update(schema.orders).set({ sourceOrderId: sale.id }).where(eq(schema.orders.id, booking.id));
    await apply("bookings", {
      bookings: [], entityPlan: emptyEntityPlan, blockers: [], summary: {},
      writes: [{ action: "update", externalId: "DH-APPLY-ALL", localId: booking.id, booking: {
        ...orderBase, code: "DH-APPLY-ALL", documentType: "booking", deliveryDate: new Date("2026-01-03T00:00:00Z"),
        lines: [{ action: "update", adoptionMethod: "mapped", localId: bookingLine.id,
          externalId: "DH-APPLY-ALL|SKU-APPLY-ALL|cái|1", line: { ...line, externalId: undefined } }],
        payments: [{ action: "update", adoptionMethod: "mapped", localId: bookingPayment.id,
          externalId: "DH-APPLY-ALL|payment|cash|1", payment: { channel: "cash", method: "cash", amount: 20 } }],
        preservedLineIds: [], preservedPaymentIds: [],
      } }],
    });
    expect((await database.select({ sourceOrderId: schema.orders.sourceOrderId }).from(schema.orders)
      .where(eq(schema.orders.id, booking.id)))[0].sourceOrderId).toBe(sale.id);
    const preservedSaleDelivery = new Date("2026-01-04T00:00:00Z");
    await database.update(schema.orders).set({ status: "returned", deliveryDate: preservedSaleDelivery })
      .where(eq(schema.orders.id, sale.id));
    await apply("sales", {
      sales: [], entityPlan: emptyEntityPlan, blockers: [], summary: {},
      writes: [{ action: "update", externalId: "HD-APPLY-ALL", localId: sale.id, sale: {
        ...orderBase, code: "HD-APPLY-ALL", documentType: "sale", sourceOrderId: null, note: "source-owned update",
        lines: [], payments: [], preservedLineIds: [saleLine.id], preservedPaymentIds: [],
      } }],
    });
    const [updatedSale] = await database.select({
      status: schema.orders.status, note: schema.orders.note, deliveryDate: schema.orders.deliveryDate,
    })
      .from(schema.orders).where(eq(schema.orders.id, sale.id));
    expect(updatedSale).toMatchObject({
      status: "returned", note: "source-owned update", deliveryDate: preservedSaleDelivery,
    });
    await database.update(schema.orders).set({ status: "draft" }).where(eq(schema.orders.id, sale.id));
    await apply("sales", {
      sales: [], entityPlan: emptyEntityPlan, blockers: [], summary: {},
      writes: [{ action: "update", externalId: "HD-APPLY-ALL", localId: sale.id, sale: {
        ...orderBase, code: "HD-APPLY-ALL", documentType: "sale", sourceOrderId: null,
        lines: [], payments: [], preservedLineIds: [saleLine.id], preservedPaymentIds: [],
      } }],
    });
    expect((await database.select({
      status: schema.orders.status, deliveryDate: schema.orders.deliveryDate,
    }).from(schema.orders).where(eq(schema.orders.id, sale.id)))[0]).toMatchObject({
      status: "completed", deliveryDate: preservedSaleDelivery,
    });
    await apply("purchases", {
      purchases: [], entityPlan: emptyEntityPlan, blockers: [], preservedLineIds: [], summary: {},
      writes: [{ action: "create", externalId: "PN-APPLY-ALL", purchase: {
        code: "PN-APPLY-ALL", status: "received", supplierId: supplier.id,
        createdAt: new Date("2026-01-01T00:00:00Z"), subtotal: 20, discount: 0, vatRate: 0,
        tax: 0, total: 20, amountPaid: 20, invoiceNumber: null, note: null, preservedLineIds: [],
        lines: [{ action: "create", adoptionMethod: "created", externalId: "PN-APPLY-ALL|SKU-APPLY-ALL|cái|1", line: {
          productId: product.id, sourceSku: "SKU-APPLY-ALL", productName: "Apply product", unitName: "Cái", unitMultiplier: 1,
          quantity: 2, unitCost: 10, discount: 0, total: 20,
        } }],
      } }],
    });
    await apply("returns", {
      returns: [], entityPlan: emptyEntityPlan, blockers: [], preservedLineIds: [], linkageExceptions: [], saleStatusUpdates: [], summary: {},
      writes: [{ action: "create", externalId: "TH-APPLY-ALL", return: {
        code: "TH-APPLY-ALL", invoiceCode: "HD-APPLY-ALL", orderId: sale.id, customerId: customer.id,
        status: "completed", createdAt: new Date("2026-01-02T00:00:00Z"), subtotal: 10, discount: 0, tax: 0,
        otherRefund: 0, returnFee: 0, totalRefund: 10, refundAmount: 10, settlementStatus: "settled", note: null,
        paymentSnapshots: [{ channel: "cash", amount: 10 }], preservedLineIds: [],
        lines: [{ action: "create", adoptionMethod: "created", externalId: "TH-APPLY-ALL|SKU-APPLY-ALL|cái|1", line: {
          orderItemId: saleLine.id, productId: product.id, sourceSku: "SKU-APPLY-ALL", productName: "Apply product",
          unitName: "Cái", unitMultiplier: 1, quantity: 1, unitPrice: 10, total: 10, restock: false,
        } }],
      } }],
    });
    await apply("purchase-returns", {
      returns: [], entityPlan: emptyEntityPlan, blockers: [], preservedLineIds: [], operationalEffects: [], summary: {},
      writes: [{ action: "create", externalId: "THN-APPLY-ALL", purchaseReturn: {
        code: "THN-APPLY-ALL", purchaseOrderId: null, supplierId: supplier.id, status: "completed", settlementStatus: "settled",
        subtotal: 10, discount: 0, vatRate: 0, tax: 0, totalRefund: 10, refundAmount: 10, refundMethod: "cash",
        debtAmount: 0, note: null, createdAt: new Date("2026-01-02T00:00:00Z"), preservedLineIds: [],
        lines: [{ action: "create", adoptionMethod: "created", externalId: "THN-APPLY-ALL|SKU-APPLY-ALL|cái|1", line: {
          purchaseOrderItemId: null, productId: product.id, sourceSku: "SKU-APPLY-ALL", productName: "Apply product",
          unitName: "Cái", unitMultiplier: 1, quantity: 1, unitCost: 10, returnUnitCost: 10, total: 10,
        } }],
      } }],
    });

    expect(await database.select().from(schema.orders).where(eq(schema.orders.code, "DH-APPLY-ALL"))).toHaveLength(1);
    expect(await database.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.code, "PN-APPLY-ALL"))).toHaveLength(1);
    expect(await database.select().from(schema.returns).where(eq(schema.returns.code, "TH-APPLY-ALL"))).toHaveLength(1);
    expect(await database.select().from(schema.purchaseReturns).where(eq(schema.purchaseReturns.code, "THN-APPLY-ALL"))).toHaveLength(1);
    const mappings = await database.select().from(schema.kiotvietSourceMappings)
      .where(and(eq(schema.kiotvietSourceMappings.storeId, STORE_ID), eq(schema.kiotvietSourceMappings.sourceSha256, SOURCE_SHA)));
    expect(mappings.map((item) => item.entityType)).toEqual(expect.arrayContaining([
      "booking", "booking_line", "booking_payment", "sale", "sale_line", "sale_payment",
      "supplier", "purchase", "purchase_line", "customer_return", "customer_return_line", "supplier_return", "supplier_return_line",
    ]));
    expect(await database.select().from(schema.stockMovements).where(eq(schema.stockMovements.storeId, STORE_ID))).toHaveLength(0);
    expect(await database.select().from(schema.cashTransactions).where(eq(schema.cashTransactions.storeId, STORE_ID))).toHaveLength(0);

    const loaded = await loadKiotVietPlanningStateFromDatabase(database, "hai-dang");
    expect(loaded.current.sales.find((item) => item.code === "HD-APPLY-ALL").fingerprint)
      .toMatch(/^[0-9a-f]{64}$/);
    expect(loaded.current.saleLines.find((item) => item.orderId === sale.id).sourceSku).toBe("SKU-APPLY-ALL");
    await database.update(schema.orderItems).set({ sourceSku: null }).where(eq(schema.orderItems.id, saleLine.id));
    const invalidSnapshot = await loadKiotVietPlanningStateFromDatabase(database, "hai-dang");
    expect(invalidSnapshot.loaderBlockers).toContainEqual({
      phase: "all", reason: "invalid_managed_source_snapshot", count: 1,
    });
    await database.update(schema.orderItems).set({ sourceSku: "SKU-APPLY-ALL" }).where(eq(schema.orderItems.id, saleLine.id));
    const saleMapping = mappings.find((item) => item.entityType === "sale" && item.externalId === "HD-APPLY-ALL");
    await database.update(schema.kiotvietSourceMappings).set({ deletedAt: new Date() })
      .where(eq(schema.kiotvietSourceMappings.id, saleMapping.id));
    const withoutTombstones = await loadKiotVietPlanningStateFromDatabase(database, "hai-dang");
    expect(withoutTombstones.current.mappings.sale ?? []).not.toContainEqual(expect.objectContaining({ externalId: "HD-APPLY-ALL" }));
  });

  test("bootstraps exact legacy documents with an empty mapping set and blocks a near-match Luma collision", async () => {
    const [warehouse] = await database.select().from(schema.warehouses)
      .where(and(eq(schema.warehouses.storeId, STORE_ID), eq(schema.warehouses.isDefault, true)));
    const [product] = await database.insert(schema.products).values({
      storeId: STORE_ID, sku: "SKU-BOOTSTRAP", name: "Bootstrap product", baseUnit: "Cái",
    }).returning();
    const [customer] = await database.insert(schema.customers).values({
      storeId: STORE_ID, code: "KH-BOOTSTRAP", name: "Bootstrap customer",
    }).returning();
    const [supplier] = await database.insert(schema.suppliers).values({
      storeId: STORE_ID, code: "NCC-BOOTSTRAP", name: "Bootstrap supplier",
    }).returning();
    const createdAt = new Date("2026-01-01T00:00:00Z");
    const [booking] = await database.insert(schema.orders).values({
      storeId: STORE_ID, code: "DH-BOOTSTRAP", documentType: "booking", status: "completed",
      paymentStatus: "unpaid", customerId: customer.id, createdAt, subtotal: "20", total: "20",
    }).returning();
    await database.insert(schema.orderItems).values({
      storeId: STORE_ID, orderId: booking.id, productId: product.id, productName: "Bootstrap product",
      unitName: "Cái", unitMultiplier: "1", quantity: "2",
      unitPrice: "10", total: "20",
    });
    const [sale] = await database.insert(schema.orders).values({
      storeId: STORE_ID, code: "HD-BOOTSTRAP", documentType: "sale", status: "completed",
      paymentStatus: "paid", customerId: customer.id, sourceOrderId: booking.id, createdAt,
      subtotal: "20", total: "20", amountPaid: "20",
    }).returning();
    const [saleLine] = await database.insert(schema.orderItems).values({
      storeId: STORE_ID, orderId: sale.id, productId: product.id, productName: "Bootstrap product",
      unitName: "Cái", unitMultiplier: "1", quantity: "2",
      unitPrice: "10", total: "20",
    }).returning();
    await database.insert(schema.payments).values({
      storeId: STORE_ID, orderId: sale.id, method: "cash", amount: "20",
      note: "Import lịch sử KiotViet",
    });
    const [purchase] = await database.insert(schema.purchaseOrders).values({
      storeId: STORE_ID, warehouseId: warehouse.id, code: "PN-BOOTSTRAP", supplierId: supplier.id,
      status: "received", createdAt, subtotal: "0", total: "20", amountPaid: "0",
    }).returning();
    await database.insert(schema.purchaseOrderItems).values({
      storeId: STORE_ID, purchaseOrderId: purchase.id, productId: product.id,
      productName: "Bootstrap product", unitName: "Cái", unitMultiplier: "1",
      quantity: "2", unitCost: "10", total: "20",
    });
    const [customerReturn] = await database.insert(schema.returns).values({
      storeId: STORE_ID, code: "TH-BOOTSTRAP", orderId: sale.id, customerId: customer.id,
      status: "completed", totalRefund: "10", createdAt,
    }).returning();
    await database.insert(schema.returnItems).values({
      storeId: STORE_ID, returnId: customerReturn.id, orderItemId: saleLine.id,
      productId: product.id, productName: "Bootstrap product", unitName: "Cái", unitMultiplier: "1",
      quantity: "1", unitPrice: "10", total: "10", restock: true,
    });
    const [supplierReturn] = await database.insert(schema.purchaseReturns).values({
      storeId: STORE_ID, warehouseId: warehouse.id, code: "THN-BOOTSTRAP", supplierId: supplier.id,
      status: "completed", settlementStatus: "unsettled", subtotal: "10", totalRefund: "10",
      debtAmount: "10", note: "Import trả hàng nhập KiotViet", createdAt,
    }).returning();
    await database.insert(schema.purchaseReturnItems).values({
      storeId: STORE_ID, purchaseReturnId: supplierReturn.id, productId: product.id,
      productName: "Bootstrap product", sku: "SKU-BOOTSTRAP", unitName: "Cái", unitMultiplier: "1",
      quantity: "1", unitCost: "10", returnUnitCost: "10", total: "10",
    });

    const rowBase = {
      "Thời gian": "01/01/2026 07:00:00", "Mã khách hàng": "KH-BOOTSTRAP",
      "Mã hàng": "SKU-BOOTSTRAP", "Tên hàng": "Bootstrap product", ĐVT: "Cái",
      "Số lượng": 2, "Trạng thái": "Hoàn thành", "Ghi chú": null,
    };
    const sources = {
      customers: [{ "Mã khách hàng": "KH-BOOTSTRAP", "Tên khách hàng": "Bootstrap customer", "Nợ cần thu hiện tại": 0, "Tổng bán trừ trả hàng": 0, "Trạng thái": "Hoạt động" }],
      suppliers: [{ "Mã nhà cung cấp": "NCC-BOOTSTRAP", "Tên nhà cung cấp": "Bootstrap supplier", "Nợ cần trả hiện tại": 0, "Trạng thái": "Hoạt động" }],
      bookings: [{ ...rowBase, "Mã đặt hàng": "DH-BOOTSTRAP", "Thời gian giao hàng": null,
        "Tổng tiền hàng": 20, "Giảm giá phiếu đặt": 0, VAT: 0, "Thu khác": 0,
        "Khách cần trả": 20, "Khách đã trả": 0, "Tiền mặt": 0, Thẻ: 0,
        "Chuyển khoản": 0, Ví: 0, Điểm: 0, "Đơn giá": 10, "Giảm giá": 0,
        "Thành tiền": 20, "Ghi chú hàng hóa": null }],
      sales: [{ ...rowBase, "Mã hóa đơn": "HD-BOOTSTRAP", "Mã đặt hàng": "DH-BOOTSTRAP",
        "Tổng tiền hàng": 20, "Giảm giá hóa đơn": 0, VAT: 0, "Thu khác": 0,
        "Khách cần trả": 20, "Khách đã trả": 20, "Tiền mặt": 20, Thẻ: 0,
        "Chuyển khoản": 0, Ví: 0, "Đơn giá": 10, "Giảm giá": 0,
        "Thành tiền": 20, "Ghi chú hàng hóa": null }],
      purchases: [{ ...rowBase, "Mã nhập hàng": "PN-BOOTSTRAP", "Mã nhà cung cấp": "NCC-BOOTSTRAP",
        "Số hóa đơn đầu vào": "", "Tổng tiền hàng": 20, "Giảm giá phiếu nhập": 0,
        "VAT nhập hàng": 0, "VAT phiếu nhập": 0, "Cần trả NCC": 20,
        "Tiền đã trả NCC": 0, "Trạng thái": "Đã nhập hàng", "Giá nhập": 10,
        "Giảm giá": 0, "Thành tiền": 20, "Ghi chú hàng hóa": null }],
      returns: [{ ...rowBase, "Mã trả hàng": "TH-BOOTSTRAP", "Mã hóa đơn": "HD-BOOTSTRAP",
        "Tổng tiền hàng trả": 10, "Giảm giá phiếu trả": 0, "VAT hoàn lại": 0,
        "Thu khác hoàn lại": 0, "Phí trả hàng": 0, "Cần trả khách": 10,
        "Đã trả khách": 0, "Tiền mặt": 0, Thẻ: 0, "Chuyển khoản": 0, Ví: 0,
        Điểm: 0, "Trạng thái": "Đã trả", "Số lượng": 1, "Giá nhập lại": 10 }],
      "purchase-returns": [{ ...rowBase, "Mã trả hàng nhập": "THN-BOOTSTRAP",
        "Mã nhà cung cấp": "NCC-BOOTSTRAP", "Tổng tiền hàng trả": 10, "Giảm giá": 0,
        "VAT trả hàng nhập": 0, "NCC cần trả": 10, "Tiền NCC trả": 0,
        "Trạng thái": "Đã trả hàng", "Ghi chú": "", "Số lượng": 1,
        "Giá trả lại": 10, "Thành tiền": 10 }],
    };
    const phases = ["customers", "suppliers", "bookings", "sales", "purchases", "returns", "purchase-returns"];
    const codeColumns = {
      customers: "Mã khách hàng", suppliers: "Mã nhà cung cấp", bookings: "Mã đặt hàng",
      sales: "Mã hóa đơn", purchases: "Mã nhập hàng", returns: "Mã trả hàng",
      "purchase-returns": "Mã trả hàng nhập",
    };
    const bundle = {
      bundleSha256: BUNDLE_SHA,
      sources: phases.map((phase) => ({
        phase, filename: `${phase}.xlsx`, path: `/tmp/${phase}.xlsx`, sha256: SOURCE_SHA,
        headers: [], rows: sources[phase], rowCount: sources[phase].length,
        documentCount: 1, codeColumn: codeColumns[phase],
      })),
    };
    const loaded = await loadKiotVietPlanningStateFromDatabase(database, "hai-dang");
    const plans = planKiotVietBundle(bundle, loaded);
    for (const phase of ["bookings", "sales", "purchases", "returns", "purchase-returns"]) {
      const plan = plans.find((candidate) => candidate.phase === phase);
      expect(plan.blockers).toEqual([]);
      expect(plan.typedPlan.entityPlan.adopts).toHaveLength(1);
      expect(plan.typedPlan.writes).toHaveLength(1);
    }

    for (const phase of ["bookings", "sales", "purchases", "returns", "purchase-returns"]) {
      const plan = plans.find((candidate) => candidate.phase === phase);
      const runId = await createAuditRepository().startRun({
        phase, sourceFileName: `${phase}-bootstrap.xlsx`, sourceSha256: SOURCE_SHA,
        bundleSha256: BUNDLE_SHA, sourceRows: 1, sourceDocuments: 1,
      });
      await database.transaction(async (rawTransaction) => {
        const syncTransaction = await createKiotVietDataSyncTransaction({
          transaction: rawTransaction, storeId: STORE_ID, expectedStoreSlug: "hai-dang",
        });
        await applyKiotVietTypedPhasePlan({
          transaction: rawTransaction, syncTransaction, storeId: STORE_ID, runId,
          sourceSha256: SOURCE_SHA, plan,
        });
      });
    }
    const bootMappings = await database.select().from(schema.kiotvietSourceMappings)
      .where(and(eq(schema.kiotvietSourceMappings.storeId, STORE_ID), eq(schema.kiotvietSourceMappings.sourceSha256, SOURCE_SHA)));
    for (const entityType of ["booking", "sale", "purchase", "customer_return", "supplier_return"]) {
      expect(bootMappings).toContainEqual(expect.objectContaining({ entityType, adoptionMethod: "legacy_adopted" }));
    }
    for (const entityType of [
      "booking_line", "sale_line", "sale_payment", "purchase_line",
      "customer_return_line", "supplier_return_line",
    ]) {
      expect(bootMappings).toContainEqual(expect.objectContaining({
        entityType, adoptionMethod: "legacy_adopted",
      }));
    }
    const rerunPlans = planKiotVietBundle(
      bundle,
      await loadKiotVietPlanningStateFromDatabase(database, "hai-dang"),
    );
    for (const phase of ["bookings", "sales", "purchases", "returns", "purchase-returns"]) {
      const rerun = rerunPlans.find((candidate) => candidate.phase === phase);
      expect(rerun.blockers).toEqual([]);
      expect(rerun.typedPlan.writes).toEqual([]);
    }

    await database.insert(schema.orders).values({
      storeId: STORE_ID, code: "DH-LUMA-COLLISION", documentType: "booking", status: "completed",
      paymentStatus: "unpaid", customerId: customer.id, createdAt, subtotal: "19", total: "19",
    });
    const [purchaseCollision] = await database.insert(schema.purchaseOrders).values({
      storeId: STORE_ID, warehouseId: warehouse.id, code: "PN-LUMA-COLLISION",
      supplierId: supplier.id, status: "received", createdAt, subtotal: "0", total: "20",
    }).returning();
    await database.insert(schema.purchaseOrderItems).values({
      storeId: STORE_ID, purchaseOrderId: purchaseCollision.id, productId: product.id,
      productName: "Bootstrap product", unitName: "Cái", unitMultiplier: "1",
      quantity: "3", unitCost: "10", total: "30",
    });
    const [saleCollision] = await database.insert(schema.orders).values({
      storeId: STORE_ID, code: "HD-LUMA-COLLISION", documentType: "sale", status: "completed",
      paymentStatus: "paid", customerId: customer.id, sourceOrderId: booking.id, createdAt,
      subtotal: "20", total: "20", amountPaid: "20",
    }).returning();
    await database.insert(schema.orderItems).values({
      storeId: STORE_ID, orderId: saleCollision.id, productId: product.id,
      productName: "Bootstrap product", unitName: "Cái", unitMultiplier: "1",
      quantity: "3", unitPrice: "10", total: "30",
    });
    await database.insert(schema.payments).values({
      storeId: STORE_ID, orderId: saleCollision.id, method: "cash", amount: "20",
      note: "Import lịch sử KiotViet",
    });
    const [returnCollision] = await database.insert(schema.returns).values({
      storeId: STORE_ID, code: "TH-LUMA-COLLISION", orderId: sale.id, customerId: customer.id,
      status: "completed", totalRefund: "10", createdAt,
    }).returning();
    await database.insert(schema.returnItems).values({
      storeId: STORE_ID, returnId: returnCollision.id, orderItemId: saleLine.id,
      productId: product.id, productName: "Bootstrap product", unitName: "Cái", unitMultiplier: "1",
      quantity: "2", unitPrice: "10", total: "20", restock: true,
    });
    const collisionBundle = structuredClone(bundle);
    collisionBundle.sources.find((item) => item.phase === "bookings").rows.push({
      ...sources.bookings[0], "Mã đặt hàng": "DH-LUMA-COLLISION",
    });
    collisionBundle.sources.find((item) => item.phase === "bookings").rowCount = 2;
    collisionBundle.sources.find((item) => item.phase === "bookings").documentCount = 2;
    collisionBundle.sources.find((item) => item.phase === "purchases").rows.push({
      ...sources.purchases[0], "Mã nhập hàng": "PN-LUMA-COLLISION",
    });
    collisionBundle.sources.find((item) => item.phase === "purchases").rowCount = 2;
    collisionBundle.sources.find((item) => item.phase === "purchases").documentCount = 2;
    collisionBundle.sources.find((item) => item.phase === "sales").rows.push({
      ...sources.sales[0], "Mã hóa đơn": "HD-LUMA-COLLISION",
    });
    collisionBundle.sources.find((item) => item.phase === "sales").rowCount = 2;
    collisionBundle.sources.find((item) => item.phase === "sales").documentCount = 2;
    collisionBundle.sources.find((item) => item.phase === "returns").rows.push({
      ...sources.returns[0], "Mã trả hàng": "TH-LUMA-COLLISION",
    });
    collisionBundle.sources.find((item) => item.phase === "returns").rowCount = 2;
    collisionBundle.sources.find((item) => item.phase === "returns").documentCount = 2;
    const collisionState = await loadKiotVietPlanningStateFromDatabase(database, "hai-dang");
    const collisionPlan = planKiotVietBundle(collisionBundle, collisionState)
      .find((candidate) => candidate.phase === "bookings");
    expect(collisionPlan.typedPlan.entityPlan.conflicts).toContainEqual(expect.objectContaining({
      externalId: "DH-LUMA-COLLISION", reason: "code_collision",
    }));
    const purchaseCollisionPlan = planKiotVietBundle(collisionBundle, collisionState)
      .find((candidate) => candidate.phase === "purchases");
    expect(purchaseCollisionPlan.typedPlan.entityPlan.conflicts).toContainEqual(expect.objectContaining({
      externalId: "PN-LUMA-COLLISION", reason: "code_collision",
    }));
    const saleCollisionPlan = planKiotVietBundle(collisionBundle, collisionState)
      .find((candidate) => candidate.phase === "sales");
    expect(saleCollisionPlan.typedPlan.entityPlan.conflicts).toContainEqual(expect.objectContaining({
      externalId: "HD-LUMA-COLLISION", reason: "code_collision",
    }));
    const returnCollisionPlan = planKiotVietBundle(collisionBundle, collisionState)
      .find((candidate) => candidate.phase === "returns");
    expect(returnCollisionPlan.typedPlan.entityPlan.conflicts).toContainEqual(expect.objectContaining({
      externalId: "TH-LUMA-COLLISION", reason: "code_collision",
    }));
  });

  test("replans a real transactional customer apply to zero managed changes", async () => {
    const phases = ["customers", "suppliers", "bookings", "sales", "purchases", "returns", "purchase-returns"];
    const bundle = {
      bundleSha256: BUNDLE_SHA,
      sources: phases.map((phase) => ({
        phase,
        filename: `${phase}.xlsx`,
        path: `/tmp/${phase}.xlsx`,
        sha256: phase === "customers" ? SOURCE_SHA : "c".repeat(64),
        headers: [],
        rows: phase === "customers" ? [{
          "Mã khách hàng": "KH-POST-ZERO",
          "Tên khách hàng": "Post zero customer",
          "Nợ cần thu hiện tại": 130_924_782,
          "Tổng bán trừ trả hàng": 3_400_176_291,
          "Trạng thái": "Hoạt động",
        }] : [],
        rowCount: phase === "customers" ? 1 : 0,
        documentCount: phase === "customers" ? 1 : 0,
        codeColumn: phase === "customers" ? "Mã khách hàng" : "code",
      })),
    };
    const beforeState = await loadKiotVietPlanningStateFromDatabase(database, "hai-dang");
    const plan = planKiotVietBundle(bundle, beforeState).find((item) => item.phase === "customers");
    expect(plan.summary.created).toBe(1);
    const applied = await applyKiotVietPhaseWithDatabase(database, {
      phase: "customers",
      storeId: STORE_ID,
      reviewedSha256: SOURCE_SHA,
      bundle,
      plan,
    });
    expect(applied.postApplyPlan.summary).toMatchObject({ created: 0, adopted: 0, updated: 0, conflicts: 0 });
    expect(applied.postApplyPlan.blockers).toEqual([]);
    const [run] = await database.select().from(schema.kiotvietSyncRuns)
      .where(eq(schema.kiotvietSyncRuns.sourceFileName, "customers.xlsx"));
    expect(run.status).toBe("completed");

    const nextSha = "d".repeat(64);
    const rerunBundle = structuredClone(bundle);
    rerunBundle.bundleSha256 = nextSha;
    rerunBundle.sources[0].sha256 = nextSha;
    const rerunState = await loadKiotVietPlanningStateFromDatabase(database, "hai-dang");
    const unchangedPlan = planKiotVietBundle(rerunBundle, rerunState).find((item) => item.phase === "customers");
    expect(unchangedPlan.summary.unchanged).toBe(1);
    await applyKiotVietPhaseWithDatabase(database, {
      phase: "customers", storeId: STORE_ID, reviewedSha256: nextSha, bundle: rerunBundle, plan: unchangedPlan,
    });
    const [refreshedMapping] = await database.select().from(schema.kiotvietSourceMappings).where(and(
      eq(schema.kiotvietSourceMappings.storeId, STORE_ID),
      eq(schema.kiotvietSourceMappings.entityType, "customer"),
      eq(schema.kiotvietSourceMappings.externalId, "KH-POST-ZERO"),
    ));
    expect(refreshedMapping.sourceSha256).toBe(nextSha);

    await database.update(schema.customers).set({ isActive: false }).where(and(
      eq(schema.customers.storeId, STORE_ID),
      eq(schema.customers.code, "KH-POST-ZERO"),
    ));
    await database.update(schema.kiotvietSourceMappings).set({ deletedAt: new Date("2026-08-31T00:00:00.000Z") }).where(and(
      eq(schema.kiotvietSourceMappings.storeId, STORE_ID),
      eq(schema.kiotvietSourceMappings.entityType, "customer"),
      eq(schema.kiotvietSourceMappings.externalId, "KH-POST-ZERO"),
    ));
    const reactivationState = await loadKiotVietPlanningStateFromDatabase(database, "hai-dang");
    expect(reactivationState.current.mappings.customer).toContainEqual({
      externalId: "KH-POST-ZERO",
      localId: refreshedMapping.localId,
    });
    const reactivationPlan = planKiotVietBundle(rerunBundle, reactivationState)
      .find((item) => item.phase === "customers");
    expect(reactivationPlan.summary).toMatchObject({ updated: 1, conflicts: 0 });
    const reactivationSha = "e".repeat(64);
    const reactivationBundle = structuredClone(rerunBundle);
    reactivationBundle.bundleSha256 = reactivationSha;
    reactivationBundle.sources[0].sha256 = reactivationSha;
    await applyKiotVietPhaseWithDatabase(database, {
      phase: "customers", storeId: STORE_ID, reviewedSha256: reactivationSha,
      bundle: reactivationBundle, plan: reactivationPlan,
    });
    const [reactivatedCustomer] = await database.select({ isActive: schema.customers.isActive })
      .from(schema.customers).where(and(
        eq(schema.customers.storeId, STORE_ID),
        eq(schema.customers.code, "KH-POST-ZERO"),
      ));
    const [reactivatedMapping] = await database.select({ deletedAt: schema.kiotvietSourceMappings.deletedAt })
      .from(schema.kiotvietSourceMappings).where(and(
        eq(schema.kiotvietSourceMappings.storeId, STORE_ID),
        eq(schema.kiotvietSourceMappings.entityType, "customer"),
        eq(schema.kiotvietSourceMappings.externalId, "KH-POST-ZERO"),
      ));
    expect(reactivatedCustomer.isActive).toBe(true);
    expect(reactivatedMapping.deletedAt).toBeNull();
  });
});
