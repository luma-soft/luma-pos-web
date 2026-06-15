"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Loader2, Save } from "lucide-react";
import Link from "next/link";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { savePrintTemplate } from "@/lib/actions/print-templates";
import type { PaperSize, PrintDocType, PrintTemplate } from "@/lib/print/template";

const DOC_TYPES: PrintDocType[] = ["order", "quote", "purchase", "return", "receipt"];
const SIZES: PaperSize[] = ["a4", "a5", "k80"];
const TOGGLES = ["showSeller", "showProject", "showDebt", "showInWords", "showSignatures", "showSku"] as const;

export function PrintSettingsForm({ templates }: { templates: Record<PrintDocType, PrintTemplate> }) {
  const t = useTranslations();
  const router = useRouter();
  const [docType, setDocType] = useState<PrintDocType>("order");
  const [drafts, setDrafts] = useState(templates);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const tpl = drafts[docType];

  function patch(p: Partial<PrintTemplate>) {
    setDrafts((d) => ({ ...d, [docType]: { ...d[docType], ...p } }));
  }
  function patchOption(key: (typeof TOGGLES)[number], value: boolean) {
    patch({ options: { ...tpl.options, [key]: value } });
  }

  /** Áp dụng thông tin cửa hàng cho tất cả loại chứng từ. */
  function applyStoreToAll() {
    setDrafts((d) => {
      const next = { ...d };
      for (const dt of DOC_TYPES) {
        next[dt] = {
          ...next[dt],
          storeName: tpl.storeName,
          storeAddress: tpl.storeAddress,
          storePhone: tpl.storePhone,
          storeTaxCode: tpl.storeTaxCode,
        };
      }
      return next;
    });
    setMsg({ ok: true, text: t("printSettings.appliedAll") });
  }

  async function save() {
    setBusy(true);
    setMsg(null);
    const res = await savePrintTemplate({
      docType: tpl.docType,
      paperDefault: tpl.paperDefault,
      storeName: tpl.storeName,
      storeAddress: tpl.storeAddress,
      storePhone: tpl.storePhone,
      storeTaxCode: tpl.storeTaxCode,
      footerNote: tpl.footerNote,
      options: tpl.options,
    });
    setBusy(false);
    if (res.ok) {
      setMsg({ ok: true, text: t("printSettings.saved") });
      router.refresh();
    } else {
      setMsg({ ok: false, text: t(res.error as never) });
    }
  }

  const inputCls = "w-full px-3 py-2 text-sm rounded-lg border border-border bg-surface";

  return (
    <div className="p-6 max-w-5xl">
      <div className="flex items-center gap-3 mb-5">
        <Link href={Routes.Settings} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <h1 className="text-2xl font-bold">{t("printSettings.title")}</h1>
      </div>

      {/* doc type tabs */}
      <div className="flex gap-1 border-b border-border mb-5 overflow-x-auto">
        {DOC_TYPES.map((dt) => (
          <button
            key={dt}
            onClick={() => { setDocType(dt); setMsg(null); }}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px whitespace-nowrap",
              docType === dt
                ? "border-primary-600 text-primary-600"
                : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
            )}
          >
            {t(`printSettings.docTypes.${dt}`)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <div className="space-y-4">
          {/* store info */}
          <div className="bg-surface border border-border rounded-card p-5 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-sm">{t("printSettings.storeSection")}</h2>
              <button onClick={applyStoreToAll} className="text-xs font-medium text-primary-600 hover:underline">
                {t("printSettings.applyAll")}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t("printSettings.storeName")}</label>
                <input value={tpl.storeName} onChange={(e) => patch({ storeName: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t("printSettings.storePhone")}</label>
                <input value={tpl.storePhone} onChange={(e) => patch({ storePhone: e.target.value })} className={inputCls} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">{t("printSettings.storeAddress")}</label>
              <input value={tpl.storeAddress} onChange={(e) => patch({ storeAddress: e.target.value })} className={inputCls} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t("printSettings.storeTaxCode")}</label>
                <input value={tpl.storeTaxCode} onChange={(e) => patch({ storeTaxCode: e.target.value })} className={inputCls} />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">{t("printSettings.paperDefault")}</label>
                <div className="flex gap-1.5">
                  {SIZES.map((s) => (
                    <button
                      key={s}
                      onClick={() => patch({ paperDefault: s })}
                      className={cn(
                        "px-3 py-2 rounded-lg text-xs font-medium border uppercase",
                        tpl.paperDefault === s ? "bg-primary-600 text-white border-primary-600" : "border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300"
                      )}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* options */}
          <div className="bg-surface border border-border rounded-card p-5 space-y-3">
            <h2 className="font-semibold text-sm">{t("printSettings.optionsSection")}</h2>
            <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
              {TOGGLES.map((k) => (
                <label key={k} className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={tpl.options[k]} onChange={(e) => patchOption(k, e.target.checked)} />
                  {t(`printSettings.toggles.${k}`)}
                </label>
              ))}
            </div>
          </div>

          {/* footer */}
          <div className="bg-surface border border-border rounded-card p-5">
            <label className="block text-xs font-medium text-slate-500 mb-1">{t("printSettings.footerNote")}</label>
            <textarea
              rows={2} value={tpl.footerNote}
              onChange={(e) => patch({ footerNote: e.target.value })}
              className={inputCls}
            />
          </div>

          <div className="flex items-center gap-3">
            <button
              onClick={save} disabled={busy}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-50"
            >
              {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {t("printSettings.saveFor", { type: t(`printSettings.docTypes.${docType}`) })}
            </button>
            {msg && <span className={cn("text-sm", msg.ok ? "text-ok" : "text-er")}>{msg.text}</span>}
          </div>
        </div>

        {/* mini preview */}
        <div className="self-start">
          <p className="text-xs font-medium text-slate-500 mb-2">{t("printSettings.preview")}</p>
          <div className="bg-white text-black rounded-lg border border-slate-300 p-4 text-[10px] leading-relaxed shadow-sm">
            <div className="flex justify-between border-b border-black pb-1.5">
              <div>
                <b className="text-[12px]">{tpl.storeName || "—"}</b>
                <div className="text-slate-600">{tpl.storeAddress}{tpl.storePhone && <><br />ĐT: {tpl.storePhone}</>}{tpl.storeTaxCode && <> · MST: {tpl.storeTaxCode}</>}</div>
              </div>
              <div className="text-right">
                <b>{t(`printSettings.previewTitles.${docType}`)}</b>
                <div className="text-slate-600">Số: XX-000 · {new Date().toLocaleDateString("vi-VN")}</div>
              </div>
            </div>
            <div className="my-1.5">
              <b>{docType === "purchase" ? "NCC" : "KH"}:</b> Nguyễn Văn A
              {tpl.options.showProject && docType === "order" && <> · <b>CT:</b> Nhà Q.7</>}
              {tpl.options.showSeller && <span className="float-right"><b>NV:</b> Dev</span>}
            </div>
            <table className="w-full border-collapse">
              <thead><tr className="bg-slate-100"><th className="border border-slate-400 px-1 text-left">SP{tpl.options.showSku && " (SKU)"}</th><th className="border border-slate-400 px-1">SL</th><th className="border border-slate-400 px-1 text-right">T.tiền</th></tr></thead>
              <tbody>
                <tr><td className="border border-slate-400 px-1">Xi măng PCB40{tpl.options.showSku && <span className="text-slate-500"> (HT40)</span>}</td><td className="border border-slate-400 px-1 text-center">50</td><td className="border border-slate-400 px-1 text-right">4.600.000</td></tr>
              </tbody>
            </table>
            <div className="text-right mt-1"><b>TỔNG: 4.600.000₫</b></div>
            {tpl.options.showDebt && <div className="text-right text-slate-600">Đã trả: 2.300.000 · Còn lại: <b>2.300.000</b></div>}
            {tpl.options.showInWords && <div className="italic text-slate-600 mt-1">Bằng chữ: Bốn triệu sáu trăm nghìn đồng.</div>}
            {tpl.options.showSignatures && (
              <div className="flex justify-between text-center mt-3"><span><b>Khách hàng</b></span><span><b>Người giao</b></span><span><b>Người lập</b></span></div>
            )}
            {tpl.footerNote && <div className="border-t border-dashed border-slate-400 mt-2 pt-1 text-center text-slate-500">{tpl.footerNote}</div>}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">{t("printSettings.previewHint")}</p>
        </div>
      </div>
    </div>
  );
}
