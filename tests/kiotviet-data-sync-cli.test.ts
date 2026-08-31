import { describe, expect, test } from "bun:test";
import {
  buildKiotVietDataSyncReport,
  assertKiotVietExecutablePlan,
  formatKiotVietDataSyncReport,
  planKiotVietBundle,
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
          summary: { parentStatusUpdates: 1 }, blockers: [],
        } };
      },
    };
    await expect(runKiotVietDataSyncCli([
      "/tmp", "--store=hai-dang", "--phase=product-references", "--apply", `--source-sha256=${bundle.bundleSha256}`,
    ], dependencies)).rejects.toThrow("post-apply dry-run is not zero-diff");
  });

  test("single-phase apply rejects post-apply child writes even when summary counters are zero", async () => {
    const bundle = emptyBundle();
    await expect(runKiotVietDataSyncCli([
      "/tmp", "--store=hai-dang", "--phase=product-references", "--apply", `--source-sha256=${bundle.bundleSha256}`,
    ], {
      readBundle: () => bundle,
      loadPlanningState: async () => ({ storeId: "store", schemaReady: true, productCatalog: {
        currentBaseProducts: [], productUnits: [], archivedSourceMappings: [], approvedHistoricalPlaceholders: [],
      } }),
      applyPhase: async () => ({ postApplyPlan: {
        phase: "product-references",
        summary: {},
        blockers: [],
        typedPlan: { writes: [{}] },
      } as never }),
    })).rejects.toThrow("post-apply dry-run is not zero-diff");
  });

  test("customer and supplier apply require the reviewed master snapshot totals", async () => {
    const bundle = emptyBundle();
    let applied = 0;
    for (const phase of ["customers", "suppliers"] as const) {
      const selectedSource = bundle.sources.find((item) => item.phase === phase)!;
      await expect(runKiotVietDataSyncCli([
        "/tmp", "--store=hai-dang", `--phase=${phase}`, "--apply", `--source-sha256=${selectedSource.sha256}`,
      ], {
        readBundle: () => bundle,
        loadPlanningState: async () => ({ storeId: "store", schemaReady: true, productCatalog: {
          currentBaseProducts: [], productUnits: [], archivedSourceMappings: [], approvedHistoricalPlaceholders: [],
        } }),
        applyPhase: async () => {
          applied += 1;
          return { postApplyPlan: { phase, summary: {}, blockers: [] } };
        },
      })).rejects.toThrow(`KiotViet ${phase === "customers" ? "customer debt" : "supplier debt"} total must be`);
    }
    expect(applied).toBe(0);
  });

  test("counts every supplier-return row with a blank source SKU or unit", () => {
    const bundle = emptyBundle();
    const selectedSource = bundle.sources.find((item) => item.phase === "purchase-returns")!;
    selectedSource.rows = [
      { "Mã trả hàng nhập": "THN-1", "Mã hàng": "", ĐVT: "Cái" },
      { "Mã trả hàng nhập": "THN-1", "Mã hàng": "SKU-1", ĐVT: "" },
      { "Mã trả hàng nhập": "THN-2", "Mã hàng": "", ĐVT: "" },
    ];
    selectedSource.rowCount = 3;
    selectedSource.documentCount = 2;
    selectedSource.codeColumn = "Mã trả hàng nhập";
    const plan = planKiotVietBundle(bundle, {
      storeId: "store",
      schemaReady: true,
      productCatalog: {
        currentBaseProducts: [], productUnits: [], archivedSourceMappings: [], approvedHistoricalPlaceholders: [],
      },
    }).find((item) => item.phase === "purchase-returns")!;
    expect(plan.typedPlan).toBeNull();
    expect(plan.summary).toMatchObject({ invalidSourceLines: 3, affectedDocuments: 2 });
    expect(plan.blockers).toEqual([{
      phase: "purchase-returns",
      reason: "blank_source_sku_or_unit",
      count: 3,
    }]);
  });
});
