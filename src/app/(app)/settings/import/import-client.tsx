"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Upload, FileText, Loader2, Check, AlertTriangle, Download } from "lucide-react";
import { cn } from "@/lib/utils";
import { importProducts, type ImportRow, type ImportSummary } from "@/lib/actions/import";

type FieldKey = "name" | "sku" | "barcode" | "category" | "unit" | "retailPrice" | "costPrice" | "stock";
const FIELDS: { key: FieldKey; required?: boolean }[] = [
  { key: "name", required: true }, { key: "sku" }, { key: "barcode" }, { key: "category" },
  { key: "unit" }, { key: "retailPrice" }, { key: "costPrice" }, { key: "stock" },
];

const stripAccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D");
const key = (s: string) => stripAccent(s).toLowerCase().replace(/[^a-z0-9]/g, "");

// gợi ý map theo tên cột (VN + EN)
const ALIASES: Record<FieldKey, string[]> = {
  name: ["tenhang", "tensanpham", "ten", "productname", "name", "tenhanghoa"],
  sku: ["mahang", "ma", "sku", "masanpham", "mahanghoa", "code"],
  barcode: ["barcode", "mavach"],
  category: ["nhomhang", "nhom", "category", "loai", "danhmuc", "loaihang"],
  unit: ["donvi", "dvt", "unit", "donvitinh"],
  retailPrice: ["giaban", "giale", "retail", "price", "dongia", "giabanle"],
  costPrice: ["giavon", "gianhap", "cost", "giagoc"],
  stock: ["tonkho", "ton", "stock", "qty", "quantity", "soluong", "toncuoi"],
};

/** CSV parser tối giản: hỗ trợ ngoặc kép, dấu phẩy & xuống dòng trong ô. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  const s = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === ",") { row.push(cell); cell = ""; }
    else if (c === "\n") { row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((x) => x.trim() !== ""));
}

export function ImportClient() {
  const t = useTranslations();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<string[][]>([]);
  const [map, setMap] = useState<Record<FieldKey, number>>({} as Record<FieldKey, number>);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setErr(""); setSummary(null); setFileName(f.name);
    const reader = new FileReader();
    reader.onload = () => {
      const all = parseCsv(String(reader.result ?? ""));
      if (all.length < 2) { setErr(t("import.errors.empty")); return; }
      const hd = all[0].map((h) => h.trim());
      setHeaders(hd); setRows(all.slice(1));
      // auto map
      const m = {} as Record<FieldKey, number>;
      for (const f of FIELDS) {
        const idx = hd.findIndex((h) => ALIASES[f.key].includes(key(h)));
        m[f.key] = idx;
      }
      setMap(m);
    };
    reader.readAsText(f);
  }

  function buildRows(): ImportRow[] {
    return rows.map((r) => {
      const o: ImportRow = {};
      for (const f of FIELDS) { const i = map[f.key]; if (i != null && i >= 0) o[f.key] = (r[i] ?? "").trim(); }
      return o;
    });
  }

  function run(dryRun: boolean) {
    setErr("");
    if (map.name == null || map.name < 0) { setErr(t("import.errors.needName")); return; }
    start(async () => {
      const res = await importProducts(buildRows(), dryRun);
      if (res.ok) { setSummary(res.data); if (!dryRun) { router.refresh(); } }
      else setErr(t(res.error as never));
    });
  }

  function downloadTemplate() {
    const head = ["Tên hàng", "Mã hàng", "Mã vạch", "Nhóm hàng", "Đơn vị", "Giá bán", "Giá vốn", "Tồn kho"];
    const ex = ["Cà phê sữa", "CF001", "8938000000001", "Đồ uống", "ly", "25000", "12000", "100"];
    const csv = "﻿" + [head, ex].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = "lumapos-products-template.csv"; a.click();
    URL.revokeObjectURL(url);
  }

  const mappedSample = rows.slice(0, 5);

  return (
    <div className="p-6 max-w-4xl">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-13 px-6 py-2.5 bg-surface border-b border-border flex items-center gap-3">
        <Link href="/settings" className="p-1.5 rounded-lg hover:bg-surface-2 text-slate-500"><ArrowLeft className="w-4 h-4" /></Link>
        <h1 className="text-[17px] font-bold">{t("import.title")}</h1>
        <button onClick={downloadTemplate} className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full border border-border hover:bg-surface-2"><Download className="w-3.5 h-3.5" />{t("import.template")}</button>
      </div>

      <div className="px-3.5 py-3 bg-in-soft border border-in/20 rounded-card text-[12px] text-in leading-relaxed mb-4">
        {t("import.intro")}
      </div>

      {/* Step 1 — upload */}
      <div className="bg-surface border border-border rounded-card p-5 mb-4">
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />
        <button onClick={() => fileRef.current?.click()} className="w-full border-2 border-dashed border-border rounded-xl py-8 grid place-items-center gap-2 hover:border-primary-400 transition">
          <Upload className="w-7 h-7 text-slate-400" />
          <span className="text-sm font-semibold">{fileName || t("import.choose")}</span>
          <span className="text-[11px] text-slate-400">{t("import.csvOnly")}</span>
        </button>
      </div>

      {/* Step 2 — mapping */}
      {headers.length > 0 && (
        <div className="bg-surface border border-border rounded-card p-5 mb-4">
          <div className="flex items-center gap-2 mb-3"><FileText className="w-4 h-4 text-primary-600" /><span className="font-bold text-sm">{t("import.mapTitle")}</span><span className="text-xs text-slate-400">· {rows.length} {t("import.rows")}</span></div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {FIELDS.map((f) => (
              <div key={f.key} className="flex items-center gap-2">
                <span className="text-xs font-semibold w-28 shrink-0">{t(`import.fields.${f.key}`)}{f.required && <span className="text-er"> *</span>}</span>
                <select value={map[f.key] ?? -1} onChange={(e) => setMap((m) => ({ ...m, [f.key]: Number(e.target.value) }))} className="flex-1 px-2.5 py-1.5 text-sm rounded-lg border border-border bg-canvas">
                  <option value={-1}>{t("import.ignore")}</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `#${i + 1}`}</option>)}
                </select>
              </div>
            ))}
          </div>

          {mappedSample.length > 0 && (
            <div className="mt-4 overflow-x-auto">
              <div className="text-[10px] font-bold uppercase text-slate-400 mb-1">{t("import.preview")}</div>
              <table className="text-xs border border-border rounded-lg overflow-hidden">
                <thead><tr className="bg-canvas">{FIELDS.filter((f) => map[f.key] >= 0).map((f) => <th key={f.key} className="px-2.5 py-1.5 text-left font-bold border-b border-border">{t(`import.fields.${f.key}`)}</th>)}</tr></thead>
                <tbody>{mappedSample.map((r, ri) => (
                  <tr key={ri} className="border-b border-border-soft last:border-0">
                    {FIELDS.filter((f) => map[f.key] >= 0).map((f) => <td key={f.key} className="px-2.5 py-1.5 whitespace-nowrap">{(r[map[f.key]] ?? "").trim() || "—"}</td>)}
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}

          <div className="flex items-center gap-2 mt-4">
            {err && <p className="text-xs text-er flex-1">{err}</p>}
            <button disabled={pending} onClick={() => run(true)} className="ml-auto inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{t("import.dryRun")}</button>
            <button disabled={pending} onClick={() => run(false)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-semibold disabled:opacity-50">{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{t("import.commit")}</button>
          </div>
        </div>
      )}

      {/* Summary */}
      {summary && (
        <div className={cn("bg-surface border rounded-card p-5", summary.applied ? "border-ok/40" : "border-border")}>
          <div className="flex items-center gap-2 mb-3">
            {summary.applied ? <Check className="w-5 h-5 text-ok" /> : <FileText className="w-5 h-5 text-slate-400" />}
            <span className="font-bold">{summary.applied ? t("import.doneTitle") : t("import.previewTitle")}</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
            {[
              [t("import.total"), summary.total, ""],
              [summary.applied ? t("import.created") : t("import.willCreate"), summary.applied ? summary.created : summary.toCreate, "text-ok"],
              [summary.applied ? t("import.updated") : t("import.willUpdate"), summary.applied ? summary.updated : summary.toUpdate, "text-in"],
              [t("import.errCount"), summary.errors.length, summary.errors.length ? "text-er" : ""],
            ].map(([l, v, c], i) => (
              <div key={i} className="px-3 py-2.5 bg-canvas border border-border rounded-[10px]">
                <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{l}</div>
                <div className={cn("font-mono text-xl font-extrabold mt-1", c as string)}>{v as number}</div>
              </div>
            ))}
          </div>
          {summary.newCategories.length > 0 && (
            <p className="text-xs text-slate-500 mb-2">{t("import.newCats", { count: summary.newCategories.length })}: {summary.newCategories.join(", ")}</p>
          )}
          {summary.errors.length > 0 && (
            <div className="text-xs text-er flex flex-col gap-0.5 max-h-32 overflow-auto">
              {summary.errors.slice(0, 20).map((e, i) => <div key={i} className="flex items-center gap-1.5"><AlertTriangle className="w-3 h-3 shrink-0" />{t("import.rowN", { n: e.row })}: {t(e.msg as never)}</div>)}
            </div>
          )}
          {summary.applied && (
            <Link href="/products" className="inline-flex items-center gap-1.5 mt-3 px-4 py-2 rounded-full bg-primary-600 text-white text-sm font-semibold">{t("import.viewProducts")}</Link>
          )}
        </div>
      )}
    </div>
  );
}
