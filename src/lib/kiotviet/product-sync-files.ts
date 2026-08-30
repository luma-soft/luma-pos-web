import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";

export type KiotVietSheetRow = Record<string, unknown>;

export function selectNewestKiotVietFilename(
  filenames: string[],
  prefix: string,
  excludePrefix?: string,
): string | null {
  const matches = filenames.filter((filename) =>
    filename.startsWith(`${prefix}_`)
    && filename.endsWith(".xlsx")
    && !filename.includes("(1)")
    && (!excludePrefix || !filename.startsWith(`${excludePrefix}_`))
  );
  return matches.sort((left, right) => right.localeCompare(left))[0] ?? null;
}

export function readKiotVietSheet(path: string): KiotVietSheetRow[] {
  const workbook = XLSX.read(readFileSync(path), { type: "buffer", cellDates: true });
  const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!firstSheet) throw new Error(`KiotViet workbook has no worksheets: ${path}`);
  return XLSX.utils.sheet_to_json(firstSheet, { defval: null });
}

export function readNewestKiotVietSheet(input: {
  directory: string;
  prefix: string;
  excludePrefix?: string;
  required?: boolean;
}): { filename: string; rows: KiotVietSheetRow[] } | null {
  const filename = selectNewestKiotVietFilename(
    readdirSync(input.directory),
    input.prefix,
    input.excludePrefix,
  );
  if (!filename) {
    if (input.required) {
      throw new Error(`Không tìm thấy ${input.prefix}_*.xlsx trong ${input.directory}`);
    }
    return null;
  }
  return { filename, rows: readKiotVietSheet(join(input.directory, filename)) };
}

export function collectHistoricalProductSkus(
  rowGroups: KiotVietSheetRow[][],
): Set<string> {
  const skus = new Set<string>();
  for (const rows of rowGroups) {
    for (const row of rows) {
      const sku = row["Mã hàng"] == null ? "" : String(row["Mã hàng"]).trim();
      if (sku) skus.add(sku);
    }
  }
  return skus;
}

export function readKiotVietProductHistory(directory: string): {
  skus: Set<string>;
  filenames: string[];
} {
  const families = [
    { prefix: "DanhSachChiTietDatHang" },
    { prefix: "DanhSachChiTietHoaDon" },
    { prefix: "DanhSachChiTietNhapHang" },
    { prefix: "DanhSachChiTietTraHang", excludePrefix: "DanhSachChiTietTraHangNhap" },
    { prefix: "DanhSachChiTietTraHangNhap" },
  ];
  const sources = families
    .map((family) => readNewestKiotVietSheet({ directory, ...family }))
    .filter((source): source is { filename: string; rows: KiotVietSheetRow[] } => source != null);
  return {
    skus: collectHistoricalProductSkus(sources.map((source) => source.rows)),
    filenames: sources.map((source) => source.filename),
  };
}
