import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import * as XLSX from "xlsx";
import {
  type KiotVietDataBundle,
  type KiotVietDataPhase,
  type KiotVietDataRow,
  type KiotVietWorkbookSource,
} from "./data-sync-types";
import {
  assertKiotVietDocumentReconciliation,
  assertUniqueKiotVietCodes,
  groupKiotVietDocumentRows,
  type KiotVietDocumentReconciliationRules,
} from "./data-sync-plan";

interface SourceDefinition {
  phase: KiotVietDataPhase;
  prefix: string;
  codeColumn: string;
  requiredHeaders: string[];
  consistentHeaderColumns?: string[];
  reconciliation?: Omit<KiotVietDocumentReconciliationRules, "codeColumn">;
  master?: boolean;
}

const SOURCE_DEFINITIONS: SourceDefinition[] = [
  {
    phase: "customers",
    prefix: "DanhSachKhachHang",
    codeColumn: "Mã khách hàng",
    requiredHeaders: ["Mã khách hàng", "Tên khách hàng", "Nợ cần thu hiện tại", "Tổng bán trừ trả hàng", "Trạng thái"],
    master: true,
  },
  {
    phase: "suppliers",
    prefix: "DanhSachNhaCungCap",
    codeColumn: "Mã nhà cung cấp",
    requiredHeaders: ["Mã nhà cung cấp", "Tên nhà cung cấp", "Nợ cần trả hiện tại", "Tổng mua trừ trả hàng", "Trạng thái"],
    master: true,
  },
  {
    phase: "bookings",
    prefix: "DanhSachChiTietDatHang",
    codeColumn: "Mã đặt hàng",
    requiredHeaders: ["Mã đặt hàng", "Mã hóa đơn", "Tổng tiền hàng", "Giảm giá phiếu đặt", "VAT", "Thu khác", "Khách cần trả", "Khách đã trả", "Tiền mặt", "Thẻ", "Chuyển khoản", "Ví", "Điểm", "Trạng thái", "Mã hàng", "Số lượng", "Thành tiền"],
    consistentHeaderColumns: ["Mã hóa đơn", "Khách cần trả", "Khách đã trả", "Trạng thái"],
    reconciliation: {
      headerTotalColumn: "Tổng tiền hàng",
      lineTotalColumn: "Thành tiền",
      payableColumn: "Khách cần trả",
      subtractHeaderColumns: ["Giảm giá phiếu đặt"],
      addHeaderColumns: ["VAT", "Thu khác"],
      paidColumn: "Khách đã trả",
      paymentColumns: ["Tiền mặt", "Thẻ", "Chuyển khoản", "Ví", "Điểm"],
    },
  },
  {
    phase: "sales",
    prefix: "DanhSachChiTietHoaDon",
    codeColumn: "Mã hóa đơn",
    requiredHeaders: ["Mã hóa đơn", "Mã đặt hàng", "Tổng tiền hàng", "Giảm giá hóa đơn", "VAT", "Thu khác", "Khách cần trả", "Khách đã trả", "Tiền mặt", "Thẻ", "Chuyển khoản", "Ví", "Trạng thái", "Mã hàng", "Số lượng", "Thành tiền"],
    consistentHeaderColumns: ["Mã đặt hàng", "Khách cần trả", "Khách đã trả", "Trạng thái"],
    reconciliation: {
      headerTotalColumn: "Tổng tiền hàng",
      lineTotalColumn: "Thành tiền",
      payableColumn: "Khách cần trả",
      subtractHeaderColumns: ["Giảm giá hóa đơn"],
      addHeaderColumns: ["VAT", "Thu khác"],
      paidColumn: "Khách đã trả",
      paymentColumns: ["Tiền mặt", "Thẻ", "Chuyển khoản", "Ví"],
    },
  },
  {
    phase: "purchases",
    prefix: "DanhSachChiTietNhapHang",
    codeColumn: "Mã nhập hàng",
    requiredHeaders: ["Mã nhập hàng", "Mã nhà cung cấp", "Tổng tiền hàng", "Giảm giá phiếu nhập", "VAT phiếu nhập", "Cần trả NCC", "Tiền đã trả NCC", "Trạng thái", "Mã hàng", "Số lượng", "Thành tiền"],
    consistentHeaderColumns: ["Mã nhà cung cấp", "Cần trả NCC", "Tiền đã trả NCC", "Trạng thái"],
    reconciliation: {
      headerTotalColumn: "Tổng tiền hàng",
      lineTotalColumn: "Thành tiền",
      payableColumn: "Cần trả NCC",
      subtractHeaderColumns: ["Giảm giá phiếu nhập"],
      addHeaderColumns: ["VAT phiếu nhập"],
    },
  },
  {
    phase: "returns",
    prefix: "DanhSachChiTietTraHang",
    codeColumn: "Mã trả hàng",
    requiredHeaders: ["Mã trả hàng", "Mã hóa đơn", "Tổng tiền hàng trả", "Giảm giá phiếu trả", "VAT hoàn lại", "Thu khác hoàn lại", "Phí trả hàng", "Cần trả khách", "Đã trả khách", "Tiền mặt", "Thẻ", "Chuyển khoản", "Ví", "Điểm", "Trạng thái", "Mã hàng", "Số lượng", "Giá nhập lại"],
    consistentHeaderColumns: ["Mã hóa đơn", "Cần trả khách", "Đã trả khách", "Trạng thái"],
    reconciliation: {
      headerTotalColumn: "Tổng tiền hàng trả",
      lineQuantityColumn: "Số lượng",
      lineUnitPriceColumn: "Giá nhập lại",
      roundEachLine: true,
      payableColumn: "Cần trả khách",
      subtractHeaderColumns: ["Giảm giá phiếu trả", "Phí trả hàng"],
      addHeaderColumns: ["VAT hoàn lại", "Thu khác hoàn lại"],
      paidColumn: "Đã trả khách",
      paymentColumns: ["Tiền mặt", "Thẻ", "Chuyển khoản", "Ví", "Điểm"],
      paymentAbsolute: true,
    },
  },
  {
    phase: "purchase-returns",
    prefix: "DanhSachChiTietTraHangNhap",
    codeColumn: "Mã trả hàng nhập",
    requiredHeaders: ["Mã trả hàng nhập", "Mã nhà cung cấp", "Tổng tiền hàng trả", "Giảm giá", "VAT trả hàng nhập", "NCC cần trả", "Tiền NCC trả", "Trạng thái", "Mã hàng", "Số lượng", "Thành tiền"],
    consistentHeaderColumns: ["Mã nhà cung cấp", "NCC cần trả", "Tiền NCC trả", "Trạng thái"],
    reconciliation: {
      headerTotalColumn: "Tổng tiền hàng trả",
      lineTotalColumn: "Thành tiền",
      payableColumn: "NCC cần trả",
      subtractHeaderColumns: ["Giảm giá"],
      addHeaderColumns: ["VAT trả hàng nhập"],
    },
  },
];

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function filenameSortKey(filename: string, prefix: string): string | null {
  const match = filename.match(new RegExp(
    `^${escapeRegex(prefix)}_KV(\\d{2})(\\d{2})(\\d{4})-(\\d{2})(\\d{2})(\\d{2})-(\\d{3})\\.xlsx$`,
  ));
  if (!match) return null;
  const [, day, month, year, hour, minute, second, sequence] = match;
  return `${year}${month}${day}${hour}${minute}${second}${sequence}`;
}

export function selectKiotVietDataFilenames(
  filenames: string[],
): Record<KiotVietDataPhase, string> {
  return Object.fromEntries(SOURCE_DEFINITIONS.map((definition) => {
    const matches = filenames
      .map((filename) => ({ filename, key: filenameSortKey(filename, definition.prefix) }))
      .filter((candidate): candidate is { filename: string; key: string } => candidate.key != null)
      .sort((left, right) => right.key.localeCompare(left.key));
    const selected = matches[0]?.filename;
    if (!selected) {
      throw new Error(`Missing KiotViet workbook: ${definition.prefix}_KV*.xlsx`);
    }
    return [definition.phase, selected];
  })) as Record<KiotVietDataPhase, string>;
}

export function sha256Bytes(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function buildKiotVietBundleSha256(
  sources: Array<{ phase: KiotVietDataPhase; sha256: string }>,
): string {
  const canonical = [...sources]
    .sort((left, right) => left.phase.localeCompare(right.phase))
    .map((source) => `${source.phase}:${source.sha256}\n`)
    .join("");
  return sha256Bytes(new TextEncoder().encode(canonical));
}

function workbookRows(buffer: Buffer, filename: string): {
  headers: string[];
  rows: KiotVietDataRow[];
} {
  // Keep Excel serials numeric. SheetJS date materialization uses the host
  // timezone and can shift historical wall-clock seconds on macOS.
  const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error(`KiotViet workbook has no worksheets: ${filename}`);
  const rawHeader = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    range: 0,
    blankrows: false,
    defval: null,
  })[0] ?? [];
  return {
    headers: rawHeader.map((value) => value == null ? "" : String(value).trim()),
    rows: XLSX.utils.sheet_to_json<KiotVietDataRow>(sheet, { defval: null }),
  };
}

function validateHeaders(
  filename: string,
  headers: string[],
  requiredHeaders: string[],
): void {
  const available = new Set(headers);
  const missing = requiredHeaders.filter((header) => !available.has(header));
  if (missing.length > 0) {
    throw new Error(`Invalid KiotViet workbook ${filename}; missing headers: ${missing.join(", ")}`);
  }
}

function reconciliationHeaderColumns(
  definition: SourceDefinition,
): string[] {
  const reconciliation = definition.reconciliation;
  if (!reconciliation) return definition.consistentHeaderColumns ?? [];
  return [...new Set([
    ...(definition.consistentHeaderColumns ?? []),
    reconciliation.headerTotalColumn,
    reconciliation.payableColumn,
    ...(reconciliation.subtractHeaderColumns ?? []),
    ...(reconciliation.addHeaderColumns ?? []),
    ...(reconciliation.paidColumn ? [reconciliation.paidColumn] : []),
    ...(reconciliation.paymentColumns ?? []),
  ])];
}

export function readKiotVietDataBundle(directory: string): KiotVietDataBundle {
  const selected = selectKiotVietDataFilenames(readdirSync(directory));
  const sources: KiotVietWorkbookSource[] = SOURCE_DEFINITIONS.map((definition) => {
    const filename = selected[definition.phase];
    const path = join(directory, filename);
    const buffer = readFileSync(path);
    const { headers, rows } = workbookRows(buffer, filename);
    validateHeaders(filename, headers, definition.requiredHeaders);

    let documentCount: number;
    if (definition.master) {
      assertUniqueKiotVietCodes(rows, definition.codeColumn);
      documentCount = rows.length;
    } else {
      documentCount = groupKiotVietDocumentRows(rows, {
        codeColumn: definition.codeColumn,
        consistentHeaderColumns: reconciliationHeaderColumns(definition),
      }).length;
      if (definition.reconciliation) {
        assertKiotVietDocumentReconciliation(rows, {
          codeColumn: definition.codeColumn,
          ...definition.reconciliation,
        });
      }
    }

    return {
      phase: definition.phase,
      filename,
      path,
      sha256: sha256Bytes(buffer),
      headers,
      rows,
      rowCount: rows.length,
      documentCount,
      codeColumn: definition.codeColumn,
    };
  });

  return {
    sources,
    bundleSha256: buildKiotVietBundleSha256(sources),
  };
}
