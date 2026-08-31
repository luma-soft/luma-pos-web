import { describe, expect, it } from "bun:test";
import {
  applyKiotVietProductSync,
  assertLegacyKiotVietImportReadOnly,
  buildProductSyncSummary,
  parseProductSyncArgs,
  type ProductSyncTransaction,
} from "@/lib/kiotviet/product-sync-runner";
import {
  planKiotVietProductSync,
  type KiotVietProduct,
  type KiotVietProductSnapshot,
} from "@/lib/kiotviet/product-sync";
import {
  collectHistoricalProductSkus,
  selectNewestKiotVietFilename,
} from "@/lib/kiotviet/product-sync-files";

const product = (sku: string, stock: number, comboComponents: KiotVietProduct["comboComponents"] = []): KiotVietProduct => ({
  sku,
  barcode: "",
  name: sku,
  productKind: comboComponents.length > 0 ? "combo" : "product",
  categoryPath: [],
  brand: "",
  baseUnit: "cái",
  costPrice: 10,
  retailPrice: 20,
  vatRate: null,
  stock,
  minLevel: 0,
  location: "",
  description: "",
  weight: null,
  imageUrls: [],
  isActive: true,
  directSale: true,
  relatedSku: null,
  specs: null,
  comboComponents,
});

describe("KiotViet product sync CLI contract", () => {
  it("selects the newest exact export family and collects historical SKUs", () => {
    const files = [
      "DanhSachChiTietTraHang_KV30082026-225644-550.xlsx",
      "DanhSachChiTietTraHangNhap_KV30082026-225857-429.xlsx",
      "DanhSachSanPham_KV30082026-224750-732.xlsx",
      "DanhSachSanPham_KV30082026-224751-001.xlsx",
      "DanhSachSanPham_KV30082026-224752-001 (1).xlsx",
    ];
    expect(selectNewestKiotVietFilename(files, "DanhSachSanPham")).toBe(
      "DanhSachSanPham_KV30082026-224751-001.xlsx",
    );
    expect(selectNewestKiotVietFilename(
      files,
      "DanhSachChiTietTraHang",
      "DanhSachChiTietTraHangNhap",
    )).toBe("DanhSachChiTietTraHang_KV30082026-225644-550.xlsx");
    expect(collectHistoricalProductSkus([
      [{ "Mã hàng": " SP-1 " }, { "Mã hàng": null }],
      [{ "Mã hàng": "SP-2" }, { "Mã hàng": "SP-1" }],
    ])).toEqual(new Set(["SP-1", "SP-2"]));
  });

  it("defaults to dry-run and requires an exact store for apply", () => {
    expect(parseProductSyncArgs([])).toEqual({
      directory: "kiotviet_data",
      storeSlug: null,
      apply: false,
    });
    expect(parseProductSyncArgs(["/tmp/kiot", "--store=hai-dang"])).toEqual({
      directory: "/tmp/kiot",
      storeSlug: "hai-dang",
      apply: false,
    });
    expect(() => parseProductSyncArgs(["/tmp/kiot", "--apply"]))
      .toThrow("--apply requires --store=hai-dang");
    expect(() => parseProductSyncArgs(["/tmp/kiot", "--apply", "--store=other-store"]))
      .toThrow("--apply requires --store=hai-dang");
    expect(parseProductSyncArgs(["/tmp/kiot", "--apply", "--store=hai-dang"])).toEqual({
      directory: "/tmp/kiot",
      storeSlug: "hai-dang",
      apply: true,
    });
  });

  it("fails closed when the legacy importer is asked to write", () => {
    expect(() => assertLegacyKiotVietImportReadOnly(true)).not.toThrow();
    expect(() => assertLegacyKiotVietImportReadOnly(false)).toThrow(
      "Legacy KiotViet writes are disabled",
    );
  });

  it("summarizes deterministic action counts and pre-migration warnings", () => {
    const snapshot: KiotVietProductSnapshot = {
      products: [product("CURRENT", 5), { ...product("NEW", 2), directSale: false }],
      units: [{
        sku: "ALT",
        baseSku: "CURRENT",
        unitName: "Box",
        multiplier: 2,
        barcode: "",
        priceOverride: 40,
        sourceStock: 2.5,
      }],
    };
    const plan = planKiotVietProductSync({
      snapshot,
      currentProducts: [
        { id: "current-id", sku: "CURRENT", stock: 3, isActive: true },
        { id: "alt-id", sku: "ALT", stock: 0, isActive: false },
        { id: "luma-id", sku: "LUMA", stock: 1, isActive: true },
      ],
      sourceMappings: [],
      historicalSkus: new Set(["ALT"]),
    });

    expect(buildProductSyncSummary({ snapshot, plan, mappingsAvailable: false })).toEqual({
      sourceProducts: 2,
      sourceUnits: 1,
      creates: 1,
      updates: 1,
      archives: 1,
      archiveReasons: {
        alternateUnitPlaceholder: 1,
        historicalMissing: 0,
        mappedMissing: 0,
      },
      preserves: 1,
      stockChanges: 2,
      netStockDelta: 4,
      inactiveSourceProducts: 0,
      notDirectSaleProducts: 1,
      mappingsAvailable: false,
      warnings: [
        "Migration product_source_mappings is not installed; dry-run uses current SKU and KiotViet history evidence only.",
      ],
    });
  });

  it("formats the net stock delta at the database quantity precision", () => {
    const snapshot = { products: [product("A", 0.1), product("B", 0.2)], units: [] };
    const plan = planKiotVietProductSync({
      snapshot,
      currentProducts: [
        { id: "a-id", sku: "A", stock: 0, isActive: true },
        { id: "b-id", sku: "B", stock: 0, isActive: true },
      ],
      sourceMappings: [],
      historicalSkus: new Set(),
    });
    expect(buildProductSyncSummary({ snapshot, plan, mappingsAvailable: true }).netStockDelta)
      .toBe(0.3);
  });
});

describe("KiotViet product sync transactional application", () => {
  it("applies managed products, units, stock, mappings, combos, and archives in one transaction", async () => {
    const snapshot: KiotVietProductSnapshot = {
      products: [
        product("PART", 4),
        {
          ...product("COMBO", 0, [{ sku: "PART", quantity: 2 }]),
          relatedSku: "PART",
        },
      ],
      units: [{
        sku: "PART-BOX",
        baseSku: "PART",
        unitName: "Box",
        multiplier: 4,
        barcode: "BOX",
        priceOverride: 80,
        sourceStock: 1,
      }],
    };
    const plan = planKiotVietProductSync({
      snapshot,
      currentProducts: [
        { id: "part-id", sku: "PART", stock: 1, isActive: true },
        { id: "deleted-id", sku: "DELETED", stock: 0, isActive: true },
        { id: "mapped-id", sku: "MAPPED", stock: 0, isActive: true },
        { id: "luma-id", sku: "LUMA", stock: 7, isActive: true },
      ],
      sourceMappings: [{ productId: "mapped-id", externalId: "MAPPED", deletedAt: null }],
      historicalSkus: new Set(["DELETED{DEL}"]),
    });
    const calls: Array<[string, ...unknown[]]> = [];
    const transaction: ProductSyncTransaction = {
      async upsertProduct(action) {
        calls.push(["upsertProduct", action.source.sku, action.productId]);
        return action.productId ?? `${action.source.sku.toLowerCase()}-id`;
      },
      async replaceUnits(productId, units) {
        calls.push(["replaceUnits", productId, units.map((unit) => unit.sku)]);
      },
      async setStock(input) {
        calls.push(["setStock", input.productId, input.quantity, input.delta, input.isCreate]);
      },
      async upsertSourceMapping(input) {
        calls.push(["upsertSourceMapping", input.productId, input.externalId, input.deletedAt]);
      },
      async markSourceDeleted(input) {
        calls.push(["markSourceDeleted", input.productId, input.externalId, input.deletedAt]);
      },
      async replaceComboItems(productId, components) {
        calls.push(["replaceComboItems", productId, components]);
      },
      async setRelatedProduct(productId, relatedProductId) {
        calls.push(["setRelatedProduct", productId, relatedProductId]);
      },
      async archiveProduct(action) {
        calls.push(["archiveProduct", action.productId, action.sku, action.reason]);
      },
    };
    let transactionCount = 0;
    const seenAt = new Date("2026-08-30T16:00:00.000Z");

    await applyKiotVietProductSync({
      snapshot,
      plan,
      seenAt,
      runInTransaction: async (work) => {
        transactionCount += 1;
        return work(transaction);
      },
    });

    expect(transactionCount).toBe(1);
    expect(calls).toEqual([
      ["upsertProduct", "COMBO", undefined],
      ["upsertProduct", "PART", "part-id"],
      ["setRelatedProduct", "combo-id", "part-id"],
      ["setRelatedProduct", "part-id", null],
      ["replaceUnits", "combo-id", []],
      ["setStock", "combo-id", 0, 0, true],
      ["upsertSourceMapping", "combo-id", "COMBO", null],
      ["replaceUnits", "part-id", ["PART-BOX"]],
      ["setStock", "part-id", 4, 3, false],
      ["upsertSourceMapping", "part-id", "PART", null],
      ["replaceComboItems", "combo-id", [{ productId: "part-id", quantity: 2 }]],
      ["replaceComboItems", "part-id", []],
      ["archiveProduct", "deleted-id", "DELETED", "historical_missing"],
      ["upsertSourceMapping", "deleted-id", "DELETED{DEL}", seenAt],
      ["archiveProduct", "mapped-id", "MAPPED", "mapped_missing"],
      ["markSourceDeleted", "mapped-id", "MAPPED", seenAt],
    ]);
    expect(calls.some((call) => call.includes("luma-id"))).toBe(false);
  });
});
