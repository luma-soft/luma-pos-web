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
});
