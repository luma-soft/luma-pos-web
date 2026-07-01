"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Copy, EyeOff, Loader2, Plus, Save, Star } from "lucide-react";
import Link from "next/link";
import { PrintDoc } from "@/components/print/print-doc";
import {
  deactivatePrintTemplate,
  duplicatePrintTemplate,
  savePrintTemplate,
  setDefaultPrintTemplate,
} from "@/lib/actions/print-templates";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import {
  DEFAULT_OPTIONS,
  PAPER_SIZES,
  PRINT_DOC_TYPES,
  defaultTemplate,
  type PaperSize,
  type PrintDocType,
  type PrintTemplate,
  type PrintTemplateStoreInfo,
} from "@/lib/print/template-shared";

const TOGGLES = ["showSeller", "showProject", "showDebt", "showDiscount", "showTax", "showLineDiscount", "showPaymentQr", "showInWords", "showSignatures", "showSku"] as const;

export function PrintSettingsForm({ templates, storeDefaults }: { templates: PrintTemplate[]; storeDefaults: PrintTemplateStoreInfo }) {
  const t = useTranslations();
  const router = useRouter();
  const [drafts, setDrafts] = useState<PrintTemplate[]>(templates);
  const [docType, setDocType] = useState<PrintDocType>("order");
  const visible = useMemo(() => drafts.filter((item) => item.docType === docType), [drafts, docType]);
  const [selectedId, setSelectedId] = useState(() => visible[0]?.id ?? defaultTemplate("order", storeDefaults).id);
  const [isPending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const selected = drafts.find((item) => item.id === selectedId && item.docType === docType) ?? visible[0] ?? defaultTemplate(docType, storeDefaults);
  const persisted = !selected.id.startsWith("draft-") && !selected.id.startsWith("default-");

  function selectDocType(next: PrintDocType) {
    setDocType(next);
    const first = drafts.find((item) => item.docType === next);
    setSelectedId(first?.id ?? defaultTemplate(next, storeDefaults).id);
    setMsg(null);
  }

  function patch(value: Partial<PrintTemplate>) {
    setDrafts((current) => current.map((item) => item.id === selected.id ? { ...item, ...value } : item));
  }

  function patchOption(key: (typeof TOGGLES)[number], value: boolean) {
    patch({ options: { ...DEFAULT_OPTIONS, ...selected.options, [key]: value } });
  }

  function addTemplate() {
    const id = `draft-${docType}-${Date.now()}`;
    const next = {
      ...defaultTemplate(docType, storeDefaults),
      id,
      name: t("printSettings.newTemplateName", { type: t(`printSettings.docTypes.${docType}`) }),
      isDefault: visible.length === 0,
      sortOrder: visible.length,
    };
    setDrafts((current) => [next, ...current]);
    setSelectedId(id);
    setMsg(null);
  }

  function runAction(
    action: () => Promise<{ ok: true; data: unknown } | { ok: false; error: string }>,
    successKey: string,
    onSuccess?: (data: unknown) => void,
  ) {
    startTransition(async () => {
      setMsg(null);
      const result = await action();
      if (result.ok) {
        onSuccess?.(result.data);
        setMsg({ ok: true, text: t(successKey as never) });
        router.refresh();
      } else {
        setMsg({ ok: false, text: t(result.error as never) });
      }
    });
  }

  function save() {
    const oldId = selected.id;
    runAction(
      () => savePrintTemplate({
        id: persisted ? selected.id : undefined,
        name: selected.name,
        docType: selected.docType,
        paperDefault: selected.paperDefault,
        isDefault: selected.isDefault,
        isActive: selected.isActive,
        sortOrder: selected.sortOrder,
        storeName: selected.storeName,
        storeAddress: selected.storeAddress,
        storePhone: selected.storePhone,
        storeTaxCode: selected.storeTaxCode,
        footerNote: selected.footerNote,
        options: { ...DEFAULT_OPTIONS, ...selected.options },
      }),
      "printSettings.saved",
      (data) => {
        const nextId = (data as { id?: string } | undefined)?.id;
        if (!nextId || nextId === oldId) return;
        setDrafts((current) => current.map((item) => item.id === oldId ? { ...item, id: nextId } : item));
        setSelectedId(nextId);
      },
    );
  }

  const inputCls = "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm";

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <Link href={Routes.Settings} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("common.back")}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("printSettings.title")}</h1>
          <p className="text-sm text-slate-500">{t("printSettings.settingsDesc")}</p>
        </div>
      </div>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {PRINT_DOC_TYPES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => selectDocType(item)}
            className={cn(
              "shrink-0 border-b-2 px-4 py-2 text-sm font-semibold",
              docType === item ? "border-primary-600 text-primary-600" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t(`printSettings.docTypes.${item}`)}
          </button>
        ))}
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-card border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border-soft p-3">
            <div className="text-sm font-bold">{t("printSettings.templateList")}</div>
            <button type="button" onClick={addTemplate} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" />
              {t("common.add")}
            </button>
          </div>
          <div className="max-h-[620px] overflow-y-auto p-2">
            {visible.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setSelectedId(item.id); setMsg(null); }}
                className={cn(
                  "mb-1 w-full rounded-lg border px-3 py-2.5 text-left text-sm transition",
                  selected.id === item.id ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200" : "border-transparent hover:bg-surface-2",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">{item.name}</span>
                  {item.isDefault && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-primary-600" />}
                </span>
                <span className="mt-1 block text-xs text-slate-500">{item.paperDefault.toUpperCase()} · {item.isActive ? t("printSettings.active") : t("printSettings.inactive")}</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="space-y-4">
            <Panel>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("printSettings.templateName")}><input value={selected.name} onChange={(event) => patch({ name: event.target.value })} className={inputCls} /></Field>
                <Field label={t("printSettings.paperDefault")}>
                  <div className="flex gap-1.5">
                    {PAPER_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => patch({ paperDefault: size })}
                        className={cn(
                          "h-10 rounded-lg border px-3 text-xs font-bold uppercase",
                          selected.paperDefault === size ? "border-primary-600 bg-primary-600 text-white" : "border-border text-slate-600 dark:text-slate-300",
                        )}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={selected.isDefault} onChange={(event) => patch({ isDefault: event.target.checked })} />
                {t("printSettings.defaultTemplate")}
              </label>
            </Panel>

            <Panel title={t("printSettings.storeSection")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("printSettings.storeName")}><input value={selected.storeName} onChange={(event) => patch({ storeName: event.target.value })} className={inputCls} /></Field>
                <Field label={t("printSettings.storePhone")}><input value={selected.storePhone} onChange={(event) => patch({ storePhone: event.target.value })} className={inputCls} /></Field>
                <Field label={t("printSettings.storeAddress")} className="sm:col-span-2"><input value={selected.storeAddress} onChange={(event) => patch({ storeAddress: event.target.value })} className={inputCls} /></Field>
                <Field label={t("printSettings.storeTaxCode")}><input value={selected.storeTaxCode} onChange={(event) => patch({ storeTaxCode: event.target.value })} className={inputCls} /></Field>
              </div>
            </Panel>

            <Panel title={t("printSettings.optionsSection")}>
              <div className="grid gap-2 sm:grid-cols-2">
                {TOGGLES.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(selected.options[key])} onChange={(event) => patchOption(key, event.target.checked)} />
                    {t(`printSettings.toggles.${key}`)}
                  </label>
                ))}
              </div>
            </Panel>

            <Panel>
              <Field label={t("printSettings.footerNote")}><textarea rows={3} value={selected.footerNote} onChange={(event) => patch({ footerNote: event.target.value })} className={inputCls} /></Field>
            </Panel>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={save} disabled={isPending} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("common.save")}
              </button>
              <button type="button" onClick={() => persisted && runAction(() => duplicatePrintTemplate(selected.id), "printSettings.duplicated")} disabled={!persisted || isPending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50">
                <Copy className="h-4 w-4" />
                {t("printSettings.duplicate")}
              </button>
              <button type="button" onClick={() => persisted && runAction(() => setDefaultPrintTemplate(selected.id), "printSettings.defaultSaved")} disabled={!persisted || selected.isDefault || isPending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50">
                <Star className="h-4 w-4" />
                {t("printSettings.setDefault")}
              </button>
              <button type="button" onClick={() => persisted && runAction(() => deactivatePrintTemplate(selected.id), "printSettings.deactivated")} disabled={!persisted || isPending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-er/40 px-4 text-sm font-semibold text-er disabled:opacity-50">
                <EyeOff className="h-4 w-4" />
                {t("printSettings.deactivate")}
              </button>
              {msg && <span className={cn("text-sm font-medium", msg.ok ? "text-ok" : "text-er")}>{msg.text}</span>}
            </div>
          </div>

          <div className="min-w-0">
            <p className="mb-2 text-xs font-semibold text-slate-500">{t("printSettings.preview")}</p>
            <div className="max-h-[720px] overflow-auto rounded-card border border-border bg-slate-200 p-4 dark:bg-slate-950">
              <div className="scale-[0.46] origin-top-left">
                <PrintDoc
                  template={selected}
                  size={selected.paperDefault as PaperSize}
                  title={t(`printSettings.previewTitles.${selected.docType}`)}
                  code="XX-000"
                  date={new Date()}
                  partyLabel={selected.docType === "purchase" ? t("purchases.cols.supplier") : t("orders.cols.customer")}
                  partyName="Nguyen Van A"
                  partyPhone="0909 000 000"
                  projectName="Nha Q.7"
                  deliveryAddress="12 Nguyen Trai"
                  sellerLabel={t("orders.detail.seller")}
                  sellerName="LumaPOS"
                  items={[{ id: "1", name: "Xi mang PCB40", sku: "HT40", unitName: "bao", quantity: 10, unitPrice: 95000, discount: 30000, total: 920000 }]}
                  totals={[
                    { label: t("pos.subtotal"), value: 920000, kind: "subtotal" },
                    { label: t("pos.discount"), value: 20000, negative: true, kind: "discount" },
                    { label: t("pos.tax"), value: 72000, kind: "tax" },
                  ]}
                  grandTotalLabel={t("print.grandTotal")}
                  grandTotal={972000}
                  afterTotals={[{ label: t("print.paid"), value: 500000 }, { label: t("print.remaining"), value: 472000, bold: true }]}
                  paymentQr={{
                    title: t("pos.sepay.title"),
                    qrImageUrl: "https://qr.sepay.vn/img?bank=VCB&acc=0123456789&amount=420000&des=XX-000",
                    bankLabel: t("pos.sepay.bank"),
                    accountLabel: t("pos.sepay.account"),
                    nameLabel: t("pos.sepay.name"),
                    referenceLabel: t("pos.sepay.reference"),
                    bankName: "Vietcombank",
                    accountNumber: "0123456789",
                    accountName: "LumaPOS",
                    reference: "XX-000",
                  }}
                  inWordsLabel={t("print.inWords")}
                  signatures={[t("print.buyerSign"), t("print.delivererSign"), t("print.sellerSign")]}
                  signHint={t("print.signHint")}
                  note={t("printSettings.previewNote")}
                  cols={{ product: t("orders.cols.product"), unit: t("orders.cols.unit"), qty: t("orders.cols.qty"), unitPrice: t("orders.cols.unitPrice"), discount: t("orders.cols.discount"), lineTotal: t("orders.cols.lineTotal") }}
                />
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface p-5">
      {title && <h2 className="mb-3 text-sm font-bold">{title}</h2>}
      {children}
    </div>
  );
}

function Field({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}
