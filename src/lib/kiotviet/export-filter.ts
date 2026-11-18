import { readFileSync, writeFileSync } from "node:fs";
import * as XLSX from "xlsx";

/**
 * Copies a KiotViet export keeping only the rows whose document code is in
 * `keep` (the header row always stays). Cells are copied as they are, so Excel
 * serial dates, number formats and every column survive unchanged.
 */
export function filterKiotVietExport(input: {
  sourcePath: string;
  targetPath: string;
  codeColumn: string;
  keep: ReadonlySet<string>;
}): { rows: number; documents: number } {
  const workbook = XLSX.read(readFileSync(input.sourcePath), { cellDates: false, cellNF: true });
  const sheetName = workbook.SheetNames[0];
  const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
  const output = XLSX.utils.book_new();
  if (!sheet || !sheet["!ref"]) {
    XLSX.utils.book_append_sheet(output, XLSX.utils.aoa_to_sheet([]), sheetName ?? "Sheet1");
    writeFileSync(input.targetPath, XLSX.write(output, { type: "buffer", bookType: "xlsx" }));
    return { rows: 0, documents: 0 };
  }
  const range = XLSX.utils.decode_range(sheet["!ref"]);
  const headers: string[] = [];
  for (let column = range.s.c; column <= range.e.c; column += 1) {
    headers.push(String(sheet[XLSX.utils.encode_cell({ r: range.s.r, c: column })]?.v ?? "").trim());
  }
  const codeIndex = headers.indexOf(input.codeColumn);
  if (codeIndex < 0) throw new Error(`${input.sourcePath} has no ${input.codeColumn} column`);

  const filtered: XLSX.WorkSheet = {};
  let outRow = 0;
  const documents = new Set<string>();
  const copyRow = (row: number) => {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell) filtered[XLSX.utils.encode_cell({ r: outRow, c: column - range.s.c })] = { ...cell };
    }
    outRow += 1;
  };
  copyRow(range.s.r);
  for (let row = range.s.r + 1; row <= range.e.r; row += 1) {
    const code = String(sheet[XLSX.utils.encode_cell({ r: row, c: codeIndex })]?.v ?? "").trim();
    if (!input.keep.has(code)) continue;
    copyRow(row);
    documents.add(code);
  }
  filtered["!ref"] = XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: outRow - 1, c: range.e.c - range.s.c } });
  XLSX.utils.book_append_sheet(output, filtered, sheetName);
  writeFileSync(input.targetPath, XLSX.write(output, { type: "buffer", bookType: "xlsx" }));
  return { rows: outRow - 1, documents: documents.size };
}
