import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as XLSX from "xlsx";
import { readKiotVietDataBundle } from "./data-sync-files.ts";
import { parseKiotVietDataSyncArgs } from "./data-sync-runner.ts";

const STAMP = "KV18112026-090000-001";
const dirs = [];

function write(dir, prefix, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "Sheet1");
  writeFileSync(join(dir, `${prefix}_${STAMP}.xlsx`), XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }));
}

/** A minimal bundle as KiotViet exports it, with the purchase tax columns hidden. */
function bundleDir({ purchasePayable }) {
  const dir = mkdtempSync(join(tmpdir(), "kiotviet-export-"));
  dirs.push(dir);
  write(dir, "DanhSachKhachHang", [
    ["Mã khách hàng", "Tên khách hàng", "Nợ cần thu hiện tại", "Tổng bán trừ trả hàng", "Trạng thái"],
    ["KH000001", "Khách", 0, 0, 1],
  ]);
  write(dir, "DanhSachNhaCungCap", [
    ["Mã nhà cung cấp", "Tên nhà cung cấp", "Nợ cần trả hiện tại", "Tổng mua trừ trả hàng", "Trạng thái"],
    ["NCC000001", "NCC", 0, 0, 1],
  ]);
  write(dir, "DanhSachChiTietDatHang", []); // empty period: no header row at all
  write(dir, "DanhSachChiTietHoaDon", [
    ["Mã hóa đơn", "Mã đặt hàng", "Tổng tiền hàng", "Giảm giá hóa đơn", "VAT", "Thu khác", "Khách cần trả", "Khách đã trả",
      "Tiền mặt", "Thẻ", "Chuyển khoản", "Ví", "Trạng thái", "Mã hàng", "Số lượng", "Thành tiền"],
  ]);
  write(dir, "DanhSachChiTietNhapHang", [
    ["Mã nhập hàng", "Mã nhà cung cấp", "Tổng tiền hàng", "Giảm giá phiếu nhập", "Cần trả NCC", "Tiền đã trả NCC",
      "Trạng thái", "Mã hàng", "Số lượng", "Thành tiền"],
    ["PN000001", "NCC000001", 100000, 0, purchasePayable, 0, "Đã nhập hàng", "SP000001", 1, 100000],
  ]);
  write(dir, "DanhSachChiTietTraHang", []);
  write(dir, "DanhSachChiTietTraHangNhap", []);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

describe("KiotViet export bundle", () => {
  test("reads hidden purchase tax columns as 0 and empty exports as empty sources", () => {
    const bundle = readKiotVietDataBundle(bundleDir({ purchasePayable: 100000 }));
    const purchases = bundle.sources.find((source) => source.phase === "purchases");
    expect(purchases.documentCount).toBe(1);
    expect(purchases.rows[0]["VAT phiếu nhập"]).toBe(0);
    expect(purchases.rows[0]["VAT nhập hàng"]).toBe(0);
    expect(bundle.sources.find((source) => source.phase === "bookings").rowCount).toBe(0);
  });

  test("still rejects a document whose tax was hidden from the export", () => {
    // Payable includes 8% VAT, but the VAT column is missing: reconciliation must fail.
    expect(() => readKiotVietDataBundle(bundleDir({ purchasePayable: 108000 }))).toThrow();
  });
});

describe("reviewed totals", () => {
  const sha = `--source-sha256=${"a".repeat(64)}`;

  test("customers and suppliers can only be applied with totals read off KiotViet", () => {
    expect(() => parseKiotVietDataSyncArgs(["dir", "--store=hai-dang", "--phase=customers", "--apply", sha]))
      .toThrow("--reviewed-customer-totals");
    expect(() => parseKiotVietDataSyncArgs(["dir", "--store=hai-dang", "--phase=suppliers", "--apply", sha]))
      .toThrow("--reviewed-supplier-totals");
    const args = parseKiotVietDataSyncArgs([
      "dir", "--store=hai-dang", "--phase=customers", "--apply", sha,
      "--reviewed-customer-totals=187.599.720:3.647.380.690",
    ]);
    expect(args.reviewedTotals.customers).toEqual({ debt: 187_599_720, net: 3_647_380_690 });
    expect(() => parseKiotVietDataSyncArgs(["dir", "--reviewed-customer-totals=abc"])).toThrow();
  });
});
