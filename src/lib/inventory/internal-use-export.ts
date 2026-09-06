import type { InternalUseIssueRow } from "@/lib/data/internal-use";
import { internalUseReasonLabel } from "./internal-use-reason";
function cell(value: unknown) {
  let text = value == null ? "" : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
}
export function internalUseCsv(rows: InternalUseIssueRow[]) {
  const lines: unknown[][] = [["Mã phiếu", "Ngày", "Trạng thái", "Bộ phận", "Lý do", "SKU", "Sản phẩm", "Đơn vị", "Hệ số", "Số lượng", "Giá vốn", "Thành tiền", "Ghi chú"]];
  for (const row of rows) for (const item of row.items) lines.push([
    row.code, row.createdAt.toISOString(), row.status, row.department, internalUseReasonLabel(row.reason, "vi"),
    item.sku, item.productName, item.unitName, item.unitMultiplier, item.quantity, item.unitCost, item.total, row.note,
  ]);
  return "\uFEFF" + lines.map(row => row.map(cell).join(",")).join("\r\n");
}
