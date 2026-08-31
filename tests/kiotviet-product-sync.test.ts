import { describe, expect, it } from "bun:test";
import {
  parseKiotVietProductRows,
  planKiotVietProductSync,
  type KiotVietProductSnapshot,
} from "@/lib/kiotviet/product-sync";

describe("KiotViet product snapshot parsing", () => {
  it("keeps base stock authoritative while preserving alternate-unit identity", () => {
    const snapshot = parseKiotVietProductRows([
      {
        "Loại hàng": "Hàng hóa",
        "Nhóm hàng(3 Cấp)": "Ống nước>>PVC",
        "Mã hàng": "SP-BASE",
        "Mã vạch": "BASE-CODE",
        "Tên hàng": "Ống nhựa",
        "Thương hiệu": "Tiền Phong",
        "Giá bán": 120_000,
        "Tỷ lệ tính thuế(%)": 8,
        "Giá vốn": 80_000,
        "Tồn kho": 52,
        "Tồn nhỏ nhất": 5,
        "ĐVT": "m",
        "Quy đổi": 1,
        "Thuộc tính": "SIZE:21|LOẠI ỐNG:C2",
        "Hình ảnh (url1,url2...)": "https://img.example/one.jpg, https://img.example/two.jpg",
        "Trọng lượng": 1.25,
        "Đang kinh doanh": 0,
        "Được bán trực tiếp": 0,
        "Mô tả": "Ống PVC thử nghiệm",
        "Vị trí": "A-01",
        "Mã HH Liên quan": "SP-GROUP",
      },
      {
        "Loại hàng": "Hàng hóa",
        "Mã hàng": "SP-ALT",
        "Mã vạch": "ALT-CODE",
        "Tên hàng": "Ống nhựa",
        "Giá bán": 480_000,
        "Giá vốn": 320_000,
        "Tồn kho": 13,
        "ĐVT": "Cây",
        "Mã ĐVT Cơ bản": "SP-BASE",
        "Quy đổi": 4,
        "Đang kinh doanh": 1,
        "Được bán trực tiếp": 1,
      },
    ]);

    expect(snapshot.products).toEqual([
      {
        sku: "SP-BASE",
        barcode: "BASE-CODE",
        name: "Ống nhựa - 21 - C2",
        productKind: "product",
        categoryPath: ["Ống nước", "PVC"],
        brand: "Tiền Phong",
        baseUnit: "m",
        costPrice: 80_000,
        retailPrice: 120_000,
        vatRate: 8,
        stock: 52,
        minLevel: 5,
        location: "A-01",
        description: "Ống PVC thử nghiệm",
        weight: 1.25,
        imageUrls: [
          "https://img.example/one.jpg",
          "https://img.example/two.jpg",
        ],
        isActive: false,
        directSale: false,
        relatedSku: "SP-GROUP",
        specs: {
          SIZE: ["21"],
          "LOẠI ỐNG": ["C2"],
        },
        comboComponents: [],
      },
    ]);
    expect(snapshot.units).toEqual([
      {
        sku: "SP-ALT",
        baseSku: "SP-BASE",
        unitName: "Cây",
        multiplier: 4,
        barcode: "ALT-CODE",
        priceOverride: 480_000,
        sourceStock: 13,
      },
    ]);
    expect(snapshot.products[0]?.stock).toBe(52);
  });

  it("maps services and parses combo components without inventing stock", () => {
    const snapshot = parseKiotVietProductRows([
      {
        "Loại hàng": "Dịch vụ",
        "Mã hàng": "SERVICE-1",
        "Tên hàng": "Lắp đặt",
        "Giá bán": 0,
        "Giá vốn": 800_000,
        "Tồn kho": 0,
        "Đang kinh doanh": 1,
        "Được bán trực tiếp": 1,
      },
      {
        "Loại hàng": "Combo - đóng gói",
        "Mã hàng": "COMBO-1",
        "Tên hàng": "Combo phòng tắm",
        "Giá bán": 0,
        "Giá vốn": 11_275_000,
        "Tồn kho": 0,
        "Đang kinh doanh": 1,
        "Được bán trực tiếp": 1,
        "Hàng thành phần": "PART-1:1|PART-2:2.5",
      },
    ]);

    expect(snapshot.products.map((product) => product.productKind)).toEqual([
      "service",
      "combo",
    ]);
    expect(snapshot.products[1]?.comboComponents).toEqual([
      { sku: "PART-1", quantity: 1 },
      { sku: "PART-2", quantity: 2.5 },
    ]);
  });
});

describe("KiotViet product synchronization planning", () => {
  const product = (sku: string, stock: number) => ({
    sku,
    barcode: "",
    name: sku,
    productKind: "product" as const,
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
    comboComponents: [],
  });

  it("updates current SKUs, creates missing SKUs, and preserves Luma-only products", () => {
    const snapshot: KiotVietProductSnapshot = {
      products: [product("SP-CURRENT", 12), product("SP-NEW", 4)],
      units: [],
    };

    const plan = planKiotVietProductSync({
      snapshot,
      currentProducts: [
        { id: "current-id", sku: "SP-CURRENT", stock: 9, isActive: true },
        { id: "luma-id", sku: "LUMA-ONLY", stock: 7, isActive: true },
      ],
      sourceMappings: [],
      historicalSkus: new Set(),
    });

    expect(plan.creates.map((action) => [action.source.sku, action.stockDelta]))
      .toEqual([["SP-NEW", 4]]);
    expect(plan.updates.map((action) => [action.productId, action.source.sku, action.stockDelta]))
      .toEqual([["current-id", "SP-CURRENT", 3]]);
    expect(plan.preserves.map((action) => action.sku)).toEqual(["LUMA-ONLY"]);
    expect(plan.archives).toEqual([]);
  });

  it("archives only proven KiotViet deletions and erroneous unit placeholders", () => {
    const snapshot: KiotVietProductSnapshot = {
      products: [product("SP-CURRENT", 1)],
      units: [{
        sku: "SP-ALT",
        baseSku: "SP-CURRENT",
        unitName: "Thùng",
        multiplier: 10,
        barcode: "",
        priceOverride: 200,
        sourceStock: 0.1,
      }],
    };

    const plan = planKiotVietProductSync({
      snapshot,
      currentProducts: [
        { id: "current-id", sku: "SP-CURRENT", stock: 1, isActive: true },
        { id: "unit-id", sku: "SP-ALT", stock: 0, isActive: false },
        { id: "history-id", sku: "SP-DELETED", stock: 0, isActive: true },
        { id: "mapped-id", sku: "SP-MAPPED-OLD", stock: 0, isActive: true },
        { id: "luma-id", sku: "LUMA-ONLY", stock: 2, isActive: true },
      ],
      sourceMappings: [{
        productId: "mapped-id",
        externalId: "SP-MAPPED-OLD",
        deletedAt: null,
      }],
      historicalSkus: new Set(["SP-DELETED", "SP-ALT"]),
    });

    expect(plan.archives.map((action) => [action.sku, action.reason])).toEqual([
      ["SP-ALT", "alternate_unit_placeholder"],
      ["SP-DELETED", "historical_missing"],
      ["SP-MAPPED-OLD", "mapped_missing"],
    ]);
    expect(plan.preserves.map((action) => action.sku)).toEqual(["LUMA-ONLY"]);
  });

  it("archives an exact stripped SKU for a KiotViet {DEL} history identity and retains that source identity", () => {
    const plan = planKiotVietProductSync({
      snapshot: { products: [], units: [] },
      currentProducts: [
        { id: "deleted-id", sku: "SP001896", stock: 0, isActive: true },
        { id: "luma-id", sku: "SP001896-LOCAL", stock: 0, isActive: true },
      ],
      sourceMappings: [],
      historicalSkus: new Set(["SP001896{DEL}"]),
    });

    expect(plan.archives).toEqual([{
      productId: "deleted-id",
      sku: "SP001896",
      sourceExternalId: "SP001896{DEL}",
      reason: "historical_missing",
    }]);
    expect(plan.preserves).toEqual([{ productId: "luma-id", sku: "SP001896-LOCAL" }]);
  });

  it("rejects duplicate products, duplicate unit SKUs, and orphan units", () => {
    expect(() => planKiotVietProductSync({
      snapshot: {
        products: [product("DUP", 0), product("DUP", 1)],
        units: [],
      },
      currentProducts: [],
      sourceMappings: [],
      historicalSkus: new Set(),
    })).toThrow("Duplicate KiotViet product SKU: DUP");

    expect(() => planKiotVietProductSync({
      snapshot: {
        products: [product("BASE", 0)],
        units: [
          { sku: "UNIT", baseSku: "BASE", unitName: "Box", multiplier: 2, barcode: "", priceOverride: null, sourceStock: 0 },
          { sku: "UNIT", baseSku: "BASE", unitName: "Carton", multiplier: 4, barcode: "", priceOverride: null, sourceStock: 0 },
        ],
      },
      currentProducts: [],
      sourceMappings: [],
      historicalSkus: new Set(),
    })).toThrow("Duplicate KiotViet unit SKU: UNIT");

    expect(() => planKiotVietProductSync({
      snapshot: {
        products: [product("BASE", 0)],
        units: [
          { sku: "ORPHAN", baseSku: "MISSING", unitName: "Box", multiplier: 2, barcode: "", priceOverride: null, sourceStock: 0 },
        ],
      },
      currentProducts: [],
      sourceMappings: [],
      historicalSkus: new Set(),
    })).toThrow("Orphan KiotViet unit SKU ORPHAN: base MISSING not found");
  });

  it("reuses a mapped product that reappears under its authoritative KiotViet SKU", () => {
    const plan = planKiotVietProductSync({
      snapshot: {
        products: [product("SP-RESTORED", 6)],
        units: [],
      },
      currentProducts: [
        { id: "restored-id", sku: "LEGACY-SKU", stock: 1, isActive: false },
      ],
      sourceMappings: [{
        productId: "restored-id",
        externalId: "SP-RESTORED",
        deletedAt: "2026-08-01T00:00:00.000Z",
      }],
      historicalSkus: new Set(),
    });

    expect(plan.creates).toEqual([]);
    expect(plan.updates.map((action) => [action.productId, action.source.sku, action.stockDelta]))
      .toEqual([["restored-id", "SP-RESTORED", 5]]);
    expect(plan.archives).toEqual([]);
  });

  it("rejects product/unit SKU collisions and unresolved combo components", () => {
    expect(() => planKiotVietProductSync({
      snapshot: {
        products: [product("COLLISION", 0)],
        units: [{
          sku: "COLLISION",
          baseSku: "COLLISION",
          unitName: "Box",
          multiplier: 2,
          barcode: "",
          priceOverride: null,
          sourceStock: 0,
        }],
      },
      currentProducts: [],
      sourceMappings: [],
      historicalSkus: new Set(),
    })).toThrow("KiotViet SKU is both a product and a unit: COLLISION");

    expect(() => planKiotVietProductSync({
      snapshot: {
        products: [{
          ...product("COMBO", 0),
          productKind: "combo",
          comboComponents: [{ sku: "MISSING-PART", quantity: 1 }],
        }],
        units: [],
      },
      currentProducts: [],
      sourceMappings: [],
      historicalSkus: new Set(),
    })).toThrow("KiotViet combo COMBO references missing component MISSING-PART");
  });
});
