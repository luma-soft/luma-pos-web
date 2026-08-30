import { describe, expect, test } from "bun:test";
import { readKiotVietDataBundle } from "@/lib/kiotviet/data-sync-files";
import {
  assertKiotVietSupplierSourceTotals,
  parseKiotVietSupplierSources,
  planKiotVietSupplierSync,
} from "@/lib/kiotviet/supplier-sync";

const managedRow = {
  "Mã nhà cung cấp": " NCC-01 ",
  "Tên nhà cung cấp": " Công ty Vật tư A ",
  "Điện thoại": "0901000001",
  Email: "a@example.test",
  "Địa chỉ": "12 Lê Lợi",
  "Phường/Xã": "Phường Bến Nghé",
  "Khu vực": "Quận 1",
  "Mã số thuế": "0312345678",
  "Công ty": "Công ty A",
  "Nhóm nhà cung cấp": "VIP",
  "Ghi chú": "Nhà cung cấp cũ",
  "Nợ cần trả hiện tại": -125000,
  "Tổng mua trừ trả hàng": 1250000,
  "Trạng thái": "0",
};

describe("KiotViet supplier master synchronization", () => {
  test("projects only source-managed supplier fields with signed debt and inactive state", () => {
    expect(parseKiotVietSupplierSources([managedRow])).toEqual([{
      externalId: "NCC-01",
      code: "NCC-01",
      name: "Công ty Vật tư A",
      phone: "0901000001",
      email: "a@example.test",
      address: "12 Lê Lợi, Phường Bến Nghé, Quận 1",
      taxCode: "0312345678",
      note: "Công ty A · VIP · Nhà cung cấp cũ",
      isActive: false,
      currentDebt: -125000,
      netPurchases: 1250000,
    }]);
  });

  test("plans managed updates without overwriting Luma-only supplier fields", () => {
    const plan = planKiotVietSupplierSync({
      sourceRows: [{ ...managedRow, "Trạng thái": "Đang giao dịch" }],
      current: [{
        localId: "supplier-1",
        code: "NCC-01",
        name: "Tên cũ",
        phone: "0901999999",
        email: "old@example.test",
        address: "Địa chỉ cũ",
        taxCode: "MST cũ",
        note: "Ghi chú cũ",
        isActive: false,
        currentDebt: "0",
        legacyImported: true,
      }],
      mappings: [],
      historicalDocumentSupplierCodes: [],
    });

    expect(plan.entityPlan.adopts).toEqual([{
      externalId: "NCC-01",
      localId: "supplier-1",
      needsUpdate: true,
    }]);
    expect(plan.writes).toEqual([{
      action: "adopt",
      externalId: "NCC-01",
      localId: "supplier-1",
      supplier: {
        code: "NCC-01",
        name: "Công ty Vật tư A",
        phone: "0901000001",
        email: "a@example.test",
        address: "12 Lê Lợi, Phường Bến Nghé, Quận 1",
        taxCode: "0312345678",
        note: "Công ty A · VIP · Nhà cung cấp cũ",
        isActive: true,
        currentDebt: -125000,
      },
    }]);
    expect(plan.summary).toMatchObject({ adopted: 1, debtCorrections: 1 });
  });

  test("preserves Luma-only suppliers, inactivates missing source-owned suppliers, and creates historical placeholders", () => {
    const plan = planKiotVietSupplierSync({
      sourceRows: [{
        "Mã nhà cung cấp": "NCC-ACTIVE",
        "Tên nhà cung cấp": "Active",
        "Nợ cần trả hiện tại": 0,
        "Tổng mua trừ trả hàng": 0,
        "Trạng thái": "Đang giao dịch",
      }],
      current: [
        {
          localId: "mapped-missing",
          code: "NCC-OLD",
          name: "Old KiotViet",
          phone: null,
          email: null,
          address: null,
          taxCode: null,
          note: null,
          isActive: true,
          currentDebt: 0,
          legacyImported: false,
        },
        {
          localId: "luma-only",
          code: "LUMA-01",
          name: "Luma supplier",
          phone: null,
          email: null,
          address: null,
          taxCode: null,
          note: null,
          isActive: true,
          currentDebt: 0,
          legacyImported: false,
        },
      ],
      mappings: [{ externalId: "NCC-OLD", localId: "mapped-missing" }],
      historicalDocumentSupplierCodes: ["", "  ", "NCC-ACTIVE", "NCC-HISTORY", "NCC-HISTORY"],
    });

    expect(plan.entityPlan.preserves).toEqual([{ localId: "luma-only", code: "LUMA-01" }]);
    expect(plan.inactivations).toEqual([{ externalId: "NCC-OLD", localId: "mapped-missing" }]);
    expect(plan.writes).toContainEqual({
      action: "inactivate",
      externalId: "NCC-OLD",
      localId: "mapped-missing",
      supplier: { isActive: false },
    });
    expect(plan.historicalPlaceholders).toEqual([{
      externalId: "NCC-HISTORY",
      code: "NCC-HISTORY",
      name: "KiotViet historical supplier NCC-HISTORY",
      isActive: false,
      currentDebt: 0,
    }]);
  });

  test("blocks a historical supplier code that collides with an unproven Luma-only supplier", () => {
    const plan = planKiotVietSupplierSync({
      sourceRows: [{
        "Mã nhà cung cấp": "NCC-ACTIVE",
        "Tên nhà cung cấp": "Active",
        "Nợ cần trả hiện tại": 0,
        "Tổng mua trừ trả hàng": 0,
        "Trạng thái": "Đang giao dịch",
      }],
      current: [{
        localId: "luma-history",
        code: "NCC-HISTORY",
        name: "Luma-only historical collision",
        phone: null,
        email: null,
        address: null,
        taxCode: null,
        note: null,
        isActive: true,
        currentDebt: 0,
        legacyImported: false,
      }],
      mappings: [],
      historicalDocumentSupplierCodes: ["NCC-HISTORY"],
    });

    expect(plan.historicalPlaceholders).toEqual([]);
    expect(plan.entityPlan.conflicts).toEqual([{
      externalId: "NCC-HISTORY",
      localId: "luma-history",
      reason: "code_collision",
    }]);
  });

  test("creates one deterministic inactive unknown supplier for purchases without a supplier code", () => {
    const plan = planKiotVietSupplierSync({
      sourceRows: [],
      current: [],
      mappings: [],
      historicalDocumentSupplierCodes: (function* () {
        yield "";
        yield "  ";
        yield null;
        yield undefined;
      })(),
    });

    expect(plan.unknownSupplierPlaceholder).toEqual({
      externalId: "__kiotviet_unknown_supplier__",
      code: null,
      name: "KiotViet unknown supplier",
      phone: null,
      email: null,
      address: null,
      taxCode: null,
      note: null,
      isActive: false,
      currentDebt: 0,
    });
    expect(plan.writes).toEqual([{
      action: "unknown_supplier_placeholder",
      externalId: "__kiotviet_unknown_supplier__",
      supplier: plan.unknownSupplierPlaceholder,
    }]);
  });

  test("reuses the tenant-scoped unknown supplier through its existing mapping", () => {
    const plan = planKiotVietSupplierSync({
      sourceRows: [],
      current: [{
        localId: "unknown-supplier",
        code: null,
        name: "KiotViet unknown supplier",
        phone: null,
        email: null,
        address: null,
        taxCode: null,
        note: null,
        isActive: false,
        currentDebt: 0,
        legacyImported: false,
      }],
      mappings: [{
        externalId: "__kiotviet_unknown_supplier__",
        localId: "unknown-supplier",
      }],
      historicalDocumentSupplierCodes: [null],
    });

    expect(plan.unknownSupplierPlaceholder).toBeNull();
    expect(plan.writes).toEqual([]);
  });

  test("reports the reviewed adoption and debt-correction counts deterministically", () => {
    const sourceRows = Array.from({ length: 59 }, (_, index) => ({
      "Mã nhà cung cấp": `NCC-${String(index + 1).padStart(3, "0")}`,
      "Tên nhà cung cấp": `Supplier ${index + 1}`,
      "Nợ cần trả hiện tại": index < 11 ? 1 : 0,
      "Tổng mua trừ trả hàng": 0,
      "Trạng thái": "Đang giao dịch",
    }));
    const current = sourceRows.slice(0, 58).map((row, index) => ({
      localId: `supplier-${index + 1}`,
      code: String(row["Mã nhà cung cấp"]),
      name: String(row["Tên nhà cung cấp"]),
      phone: null,
      email: null,
      address: null,
      taxCode: null,
      note: null,
      isActive: true,
      currentDebt: 0,
      legacyImported: true,
    }));

    expect(planKiotVietSupplierSync({
      sourceRows,
      current,
      mappings: [],
      historicalDocumentSupplierCodes: [],
    }).summary).toMatchObject({
      adopted: 58,
      created: 1,
      debtCorrections: 11,
    });
  });

  test("requires the reviewed source debt and net-purchases totals before apply", () => {
    expect(() => assertKiotVietSupplierSourceTotals([{
      externalId: "NCC-TOTALS",
      code: "NCC-TOTALS",
      name: "Totals",
      phone: null,
      email: null,
      address: null,
      taxCode: null,
      note: null,
      isActive: true,
      currentDebt: 69447521,
      netPurchases: 4032549434,
    }])).not.toThrow();
    expect(() => assertKiotVietSupplierSourceTotals([])).toThrow("supplier debt total");
  });
});

const suppliedBundleDirectory = process.env.KIOTVIET_BUNDLE_DIR;
const suppliedBundleTest = suppliedBundleDirectory ? test : test.skip;

suppliedBundleTest("verifies the reviewed supplier totals from the supplied workbook", () => {
  const supplierSource = readKiotVietDataBundle(suppliedBundleDirectory!).sources
    .find((source) => source.phase === "suppliers");
  expect(supplierSource).toBeDefined();
  const suppliers = parseKiotVietSupplierSources(supplierSource!.rows);
  expect(suppliers).toHaveLength(59);
  expect(() => assertKiotVietSupplierSourceTotals(suppliers)).not.toThrow();
});
