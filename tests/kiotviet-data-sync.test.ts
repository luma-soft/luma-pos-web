import { describe, expect, test } from "bun:test";
import {
  buildKiotVietBundleSha256,
  readKiotVietDataBundle,
  selectKiotVietDataFilenames,
  sha256Bytes,
} from "@/lib/kiotviet/data-sync-files";
import {
  assertKiotVietDocumentReconciliation,
  buildKiotVietChildExternalId,
  groupKiotVietDocumentRows,
  normalizeKiotVietDate,
  normalizeKiotVietNumber,
  normalizeKiotVietText,
  planKiotVietEntities,
  stableKiotVietFingerprint,
} from "@/lib/kiotviet/data-sync-plan";

describe("KiotViet remaining-data file contract", () => {
  test("selects the newest exact workbook from every supported family", () => {
    expect(selectKiotVietDataFilenames([
      "DanhSachKhachHang_KV30082026-225042-104.xlsx",
      "DanhSachKhachHang_KV01092026-000001-001.xlsx",
      "DanhSachKhachHang_KV01092026-000001-001 (1).xlsx",
      "DanhSachNhaCungCap_KV30082026-225048-447.xlsx",
      "DanhSachChiTietDatHang_KV30082026-225705-529.xlsx",
      "DanhSachChiTietHoaDon_KV30082026-225731-462.xlsx",
      "DanhSachChiTietNhapHang_KV30082026-225820-542.xlsx",
      "DanhSachChiTietTraHang_KV30082026-225644-550.xlsx",
      "DanhSachChiTietTraHangNhap_KV30082026-225857-429.xlsx",
      "DanhSachChiTietTraHangNhap_KV30082026-225900-001.csv",
    ])).toEqual({
      customers: "DanhSachKhachHang_KV01092026-000001-001.xlsx",
      suppliers: "DanhSachNhaCungCap_KV30082026-225048-447.xlsx",
      bookings: "DanhSachChiTietDatHang_KV30082026-225705-529.xlsx",
      sales: "DanhSachChiTietHoaDon_KV30082026-225731-462.xlsx",
      purchases: "DanhSachChiTietNhapHang_KV30082026-225820-542.xlsx",
      returns: "DanhSachChiTietTraHang_KV30082026-225644-550.xlsx",
      "purchase-returns": "DanhSachChiTietTraHangNhap_KV30082026-225857-429.xlsx",
    });
  });

  test("hashes files and bundles deterministically", () => {
    const abc = sha256Bytes(new TextEncoder().encode("abc"));
    expect(abc).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(buildKiotVietBundleSha256([
      { phase: "sales", sha256: "b".repeat(64) },
      { phase: "customers", sha256: "a".repeat(64) },
    ])).toBe("dddc46b23b609f69d728fcf25e30d62fcc44375ff92f81522891e3b026a8ddff");
    expect(buildKiotVietBundleSha256([
      { phase: "customers", sha256: "a".repeat(64) },
      { phase: "sales", sha256: "b".repeat(64) },
    ])).toBe("dddc46b23b609f69d728fcf25e30d62fcc44375ff92f81522891e3b026a8ddff");
  });
});

describe("KiotViet remaining-data normalization and grouping", () => {
  test("normalizes source text, numbers, and dates without locale-dependent fallback", () => {
    expect(normalizeKiotVietText("  O\u0302\u0301ng nước  ")).toBe("Ống nước");
    expect(normalizeKiotVietNumber(null)).toBe(0);
    expect(normalizeKiotVietNumber("12.5")).toBe(12.5);
    expect(() => normalizeKiotVietNumber("mười hai")).toThrow("Invalid KiotViet number");
    expect(normalizeKiotVietDate(25569).toISOString()).toBe("1969-12-31T17:00:00.000Z");
    expect(normalizeKiotVietDate("30/08/2026 22:57").toISOString()).toBe("2026-08-30T15:57:00.000Z");
    expect(() => normalizeKiotVietDate("08/31/2026")).toThrow("Invalid KiotViet date");
    expect(() => normalizeKiotVietDate("August 31, 2026")).toThrow("Invalid KiotViet date");
    expect(() => normalizeKiotVietDate("not-a-date")).toThrow("Invalid KiotViet date");
  });

  test("groups repeated document lines and rejects contradictory headers", () => {
    expect(groupKiotVietDocumentRows([
      { "Mã hóa đơn": " HD01 ", "Trạng thái": "Hoàn thành", "Mã hàng": "A" },
      { "Mã hóa đơn": "HD01", "Trạng thái": "Hoàn thành", "Mã hàng": "B" },
      { "Mã hóa đơn": "HD02", "Trạng thái": "Hoàn thành", "Mã hàng": "C" },
    ], {
      codeColumn: "Mã hóa đơn",
      consistentHeaderColumns: ["Trạng thái"],
    }).map((group) => [group.externalId, group.rows.length])).toEqual([
      ["HD01", 2],
      ["HD02", 1],
    ]);

    expect(() => groupKiotVietDocumentRows([
      { "Mã hóa đơn": "HD01", "Trạng thái": "Hoàn thành" },
      { "Mã hóa đơn": "HD01", "Trạng thái": "Đã hủy" },
    ], {
      codeColumn: "Mã hóa đơn",
      consistentHeaderColumns: ["Trạng thái"],
    })).toThrow("Contradictory KiotViet header");
  });

  test("reconciles line, payable, and payment totals before planning writes", () => {
    const rules = {
      codeColumn: "Mã trả hàng",
      headerTotalColumn: "Tổng tiền hàng trả",
      lineTotalColumn: "Thành tiền",
      payableColumn: "Cần trả khách",
      subtractHeaderColumns: ["Giảm giá"],
      addHeaderColumns: ["VAT"],
      paidColumn: "Đã trả khách",
      paymentColumns: ["Tiền mặt", "Chuyển khoản"],
      paymentAbsolute: true,
    };
    const rows = [
      {
        "Mã trả hàng": "TH01",
        "Tổng tiền hàng trả": 30,
        "Giảm giá": 3,
        VAT: 1,
        "Cần trả khách": 28,
        "Đã trả khách": -28,
        "Tiền mặt": 20,
        "Chuyển khoản": 8,
        "Thành tiền": 10,
      },
      {
        "Mã trả hàng": "TH01",
        "Tổng tiền hàng trả": 30,
        "Giảm giá": 3,
        VAT: 1,
        "Cần trả khách": 28,
        "Đã trả khách": -28,
        "Tiền mặt": 20,
        "Chuyển khoản": 8,
        "Thành tiền": 20,
      },
    ];
    expect(() => assertKiotVietDocumentReconciliation(rows, rules)).not.toThrow();
    expect(() => assertKiotVietDocumentReconciliation([
      rows[0],
      { ...rows[1], "Thành tiền": 21 },
    ], rules)).toThrow("line total mismatch");
    expect(() => assertKiotVietDocumentReconciliation([
      { ...rows[0], "Tiền mặt": 19 },
      { ...rows[1], "Tiền mặt": 19 },
    ], rules)).toThrow("payment total mismatch");
  });

  test("builds stable child keys for duplicate SKU and unit lines", () => {
    expect(buildKiotVietChildExternalId({
      documentCode: " HD01 ",
      sku: " SP|01 ",
      unitName: " Hộp ",
      occurrence: 2,
    })).toBe("HD01|SP\\|01|hộp|2");
    expect(() => buildKiotVietChildExternalId({
      documentCode: "HD01",
      sku: "SP01",
      unitName: "Cái",
      occurrence: 0,
    })).toThrow("positive occurrence");
  });
});

describe("KiotViet generic entity planning", () => {
  test("uses mappings first, safely adopts legacy rows, blocks collisions, and preserves Luma-only rows", () => {
    const plan = planKiotVietEntities({
      sources: [
        { externalId: "A", fingerprint: "source-a" },
        { externalId: "B", fingerprint: "same-b" },
        { externalId: "C", fingerprint: "source-c" },
        { externalId: "D", fingerprint: "source-d" },
        { externalId: "E", fingerprint: "source-e" },
      ],
      mappings: [
        { externalId: "A", localId: "local-a" },
        { externalId: "B", localId: "local-b" },
        { externalId: "E", localId: "missing-local" },
      ],
      current: [
        { localId: "local-a", code: "OLD-A", fingerprint: "old-a", legacyImported: false },
        { localId: "local-b", code: "B", fingerprint: "same-b", legacyImported: false },
        { localId: "local-c", code: "C", fingerprint: "old-c", legacyImported: true },
        { localId: "local-d", code: "D", fingerprint: "different-d", legacyImported: false },
        { localId: "luma-no-code", code: null, fingerprint: "no-code", legacyImported: false },
        { localId: "luma-only", code: "LUMA", fingerprint: "luma", legacyImported: false },
      ],
    });

    expect(plan).toEqual({
      creates: [],
      adopts: [{ externalId: "C", localId: "local-c", needsUpdate: true }],
      updates: [{ externalId: "A", localId: "local-a" }],
      unchanged: [{ externalId: "B", localId: "local-b" }],
      conflicts: [
        { externalId: "D", localId: "local-d", reason: "code_collision" },
        { externalId: "E", localId: "missing-local", reason: "mapped_local_missing" },
      ],
      preserves: [
        { localId: "luma-no-code", code: "" },
        { localId: "luma-only", code: "LUMA" },
      ],
    });
  });

  test("rejects duplicate source identities and fingerprints objects canonically", () => {
    expect(stableKiotVietFingerprint({ b: 2, a: ["x", { z: true }] }))
      .toBe(stableKiotVietFingerprint({ a: ["x", { z: true }], b: 2 }));
    expect(() => planKiotVietEntities({
      sources: [
        { externalId: "DUP", fingerprint: "one" },
        { externalId: " DUP ", fingerprint: "two" },
      ],
      mappings: [],
      current: [],
    })).toThrow("Duplicate KiotViet source identity: DUP");
  });
});

const suppliedBundleDirectory = process.env.KIOTVIET_BUNDLE_DIR;
const suppliedBundleTest = suppliedBundleDirectory ? test : test.skip;

suppliedBundleTest("reads and validates the seven supplied workbooks", () => {
  const bundle = readKiotVietDataBundle(suppliedBundleDirectory!);
  expect(Object.fromEntries(bundle.sources.map((source) => [source.phase, {
    rows: source.rowCount,
    documents: source.documentCount,
  }]))).toEqual({
    customers: { rows: 103, documents: 103 },
    suppliers: { rows: 59, documents: 59 },
    bookings: { rows: 361, documents: 23 },
    sales: { rows: 9305, documents: 2839 },
    purchases: { rows: 4611, documents: 1169 },
    returns: { rows: 440, documents: 113 },
    "purchase-returns": { rows: 198, documents: 65 },
  });
  expect(bundle.sources.every((source) => /^[0-9a-f]{64}$/.test(source.sha256))).toBe(true);
  expect(bundle.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
  const firstSale = bundle.sources.find((source) => source.phase === "sales")!.rows[0]!;
  expect(normalizeKiotVietDate(firstSale["Thời gian"]).toISOString())
    .toBe("2026-08-30T12:38:56.000Z");
});
