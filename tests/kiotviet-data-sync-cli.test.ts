import { describe, expect, test } from "bun:test";
import {
  buildKiotVietDataSyncReport,
  assertKiotVietExecutablePlan,
  formatKiotVietDataSyncReport,
  reviewedHashForPhase,
  runKiotVietDataSyncCli,
} from "@/scripts/sync-kiotviet-data";
import type { KiotVietDataBundle } from "@/lib/kiotviet/data-sync-types";
import type { KiotVietDataSyncCliDependencies } from "@/scripts/sync-kiotviet-data";
import { assertLegacyKiotVietDataImportReadOnly } from "@/lib/kiotviet/data-sync-runner";

const sha = (value: string) => value.repeat(64);

function emptyBundle(): KiotVietDataBundle {
  const phases = ["customers", "suppliers", "bookings", "sales", "purchases", "returns", "purchase-returns"] as const;
  return {
    bundleSha256: sha("b"),
    sources: phases.map((phase, index) => ({
      phase,
      filename: `${phase}.xlsx`,
      path: `/tmp/${phase}.xlsx`,
      sha256: String(index + 1).repeat(64),
      headers: [], rows: [], rowCount: 0, documentCount: 0, codeColumn: "code",
    })),
  };
}

describe("guarded KiotViet data sync CLI", () => {
  test("rejects unresolved synthetic local IDs before an apply transaction", () => {
    expect(() => assertKiotVietExecutablePlan({
      phase: "sales",
      summary: {},
      blockers: [],
      typedPlan: { writes: [{ sale: { customerId: "pending-customer:KH-1" } }] },
    } as never)).toThrow("unresolved local reference");
  });

  test("uses the bundle hash for product references and workbook hash otherwise", () => {
    const bundle = emptyBundle();
    expect(reviewedHashForPhase(bundle, "product-references")).toBe(bundle.bundleSha256);
    expect(reviewedHashForPhase(bundle, "sales")).toBe(bundle.sources[3]!.sha256);
  });

  test("formats stable JSON without source rows or PII", () => {
    const report = buildKiotVietDataSyncReport({
      bundle: emptyBundle(), phase: "all", storeSlug: "hai-dang", schemaReady: false,
      plans: [], blockers: [{ phase: "all", reason: "missing_prerequisite_schema", count: 1 }],
    });
    const first = formatKiotVietDataSyncReport(report);
    const second = formatKiotVietDataSyncReport(report);
    expect(first.json).toBe(second.json);
    expect(first.json).not.toContain("sourceRows");
    expect(first.text).toContain("DRY-RUN");
    expect(first.text).toContain("missing_prerequisite_schema");
  });

  test("dry-run never opens an apply transaction and all apply is rejected", async () => {
    let applied = 0;
    const bundle = emptyBundle();
    const dryRun = await runKiotVietDataSyncCli([
      "/tmp", "--store=hai-dang", "--phase=all",
    ], {
      readBundle: () => bundle,
      loadPlanningState: async () => ({ storeId: "store", schemaReady: false, productCatalog: {
        currentBaseProducts: [], productUnits: [], archivedSourceMappings: [], approvedHistoricalPlaceholders: [],
      } }),
      applyPhase: async () => { applied += 1; throw new Error("must not apply"); },
    });
    expect(dryRun.report.status).toBe("dry-run");
    expect(applied).toBe(0);
    await expect(runKiotVietDataSyncCli([
      "/tmp", "--store=hai-dang", "--phase=all", "--apply", `--source-sha256=${sha("b")}`,
    ], {
      readBundle: () => bundle,
      loadPlanningState: async () => { throw new Error("must fail before load"); },
      applyPhase: async () => { applied += 1; return { postApplyPlan: { phase: "product-references", summary: {}, blockers: [] } }; },
    })).rejects.toThrow("--phase=all is dry-run only");
    expect(applied).toBe(0);
  });

  test("apply validates product-reference bundle hash before mutation", async () => {
    let applied = 0;
    const bundle = emptyBundle();
    await expect(runKiotVietDataSyncCli([
      "/tmp", "--store=hai-dang", "--phase=product-references", "--apply", `--source-sha256=${sha("c")}`,
    ], {
      readBundle: () => bundle,
      loadPlanningState: async () => ({ storeId: "store", schemaReady: true, productCatalog: {
        currentBaseProducts: [], productUnits: [], archivedSourceMappings: [], approvedHistoricalPlaceholders: [],
      } }),
      applyPhase: async () => { applied += 1; return { postApplyPlan: { phase: "product-references", summary: {}, blockers: [] } }; },
    })).rejects.toThrow("reviewed source SHA-256 does not match");
    expect(applied).toBe(0);
  });

  test("legacy data writers fail closed and direct operators to the guarded CLI", () => {
    expect(() => assertLegacyKiotVietDataImportReadOnly(true)).not.toThrow();
    expect(() => assertLegacyKiotVietDataImportReadOnly(false)).toThrow("bun sync:kiotviet-data");
  });

  test("single-phase apply requires the adapter's transactional reload to be zero-diff", async () => {
    const bundle = emptyBundle();
    const dependencies: KiotVietDataSyncCliDependencies = {
      readBundle: () => bundle,
      loadPlanningState: async () => ({ storeId: "store", schemaReady: true, productCatalog: {
        currentBaseProducts: [], productUnits: [], archivedSourceMappings: [], approvedHistoricalPlaceholders: [],
      } }),
      applyPhase: async (input) => {
        expect(input.plan.typedPlan).toBeDefined();
        return { postApplyPlan: {
          phase: "product-references" as const,
          summary: { creates: 1 }, blockers: [],
        } };
      },
    };
    await expect(runKiotVietDataSyncCli([
      "/tmp", "--store=hai-dang", "--phase=product-references", "--apply", `--source-sha256=${bundle.bundleSha256}`,
    ], dependencies)).rejects.toThrow("post-apply dry-run is not zero-diff");
  });
});
