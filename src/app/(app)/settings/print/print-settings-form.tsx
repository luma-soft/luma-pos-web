"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Select } from "@/components/ui/select";
import { useEffect, useLayoutEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Copy, EyeOff, Loader2, Maximize2, Minimize2, Plus, Save, Star } from "lucide-react";
import { PrintDoc } from "@/components/print/print-doc";
import { PrintRichTextEditor } from "@/components/print/print-rich-text-editor";
import { MobileDetailHeader } from "@/components/mobile-detail-header";
import {
  deactivatePrintTemplate,
  duplicatePrintTemplate,
  savePrintTemplate,
  setDefaultPrintTemplate,
} from "@/lib/actions/print-templates";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { buildVietQrImageUrl, formatPrintPaymentReference, resolvePrintPaymentQrAccount } from "@/lib/print/payment-qr";
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

const OPTION_GROUPS = [
  { key: "content", options: ["showSeller", "showProject", "showPartyPhone", "showDeliveryAddress", "showInWords", "showSignatures", "showSku"] },
  { key: "pricing", options: ["showDebt", "showDiscount", "showLineDiscount", "showLineDiscountPercent", "showLineDiscountAmount", "showTax", "showPaymentQr", "alwaysShowPaymentQr"] },
  { key: "batch", options: ["showBatchDebtSummary"] },
] as const;
const SIGNATURE_LABELS = ["signatureLeftLabel", "signatureMiddleLabel", "signatureRightLabel"] as const;
const QR_VISIBILITY_OPTIONS = ["showPaymentQrBank", "showPaymentQrAccountNumber", "showPaymentQrAccountName", "showPaymentQrReference"] as const;
const VIETQR_BANKS = [
  ["VCB", "Vietcombank"], ["ICB", "VietinBank"], ["BIDV", "BIDV"], ["VBA", "Agribank"],
  ["MB", "MBBank"], ["TCB", "Techcombank"], ["ACB", "ACB"], ["VPB", "VPBank"],
  ["TPB", "TPBank"], ["MSB", "MSB"], ["LPB", "LPBank"], ["VCCB", "BVBank"],
  ["STB", "Sacombank"], ["VIB", "VIB"], ["HDB", "HDBank"], ["SEAB", "SeABank"],
  ["SHBVN", "ShinhanBank"], ["BAB", "BacABank"], ["ABB", "ABBANK"], ["EIB", "Eximbank"],
  ["PBVN", "PublicBank"], ["OCB", "OCB"], ["KLB", "KienLongBank"],
] as const;
type ToggleOptionKey = (typeof OPTION_GROUPS)[number]["options"][number];
type BooleanOptionKey = ToggleOptionKey | (typeof QR_VISIBILITY_OPTIONS)[number];
type TextOptionKey = (typeof SIGNATURE_LABELS)[number] | "taxLabel" | "paymentQrTitle" | "paymentQrContentTemplate" | "paymentQrCustomAccountNumber" | "paymentQrCustomAccountName";

export function PrintSettingsForm({ templates, storeDefaults }: { templates: PrintTemplate[]; storeDefaults: PrintTemplateStoreInfo }) {
  const t = useTranslations();
  const router = useRouter();
  const [drafts, setDrafts] = useState<PrintTemplate[]>(templates);
  const [docType, setDocType] = useState<PrintDocType>("order");
  const visible = useMemo(() => drafts.filter((item) => item.docType === docType), [drafts, docType]);
  const [selectedId, setSelectedId] = useState(() => visible[0]?.id ?? defaultTemplate("order", storeDefaults).id);
  const [isPending, startTransition] = useTransition();
  const [isPreviewFullscreen, setIsPreviewFullscreen] = useState(false);
  const previewSurfaceRef = useRef<HTMLDivElement>(null);
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

  function patchOption(key: BooleanOptionKey, value: boolean) {
    patch({ options: { ...DEFAULT_OPTIONS, ...selected.options, [key]: value } });
  }

  function patchTextOption(key: TextOptionKey, value: string) {
    patch({ options: { ...DEFAULT_OPTIONS, ...selected.options, [key]: value } });
  }

  function patchCustomQrBank(bankCode: string) {
    const bank = VIETQR_BANKS.find(([code]) => code === bankCode);
    patch({
      options: {
        ...DEFAULT_OPTIONS,
        ...selected.options,
        paymentQrCustomBankCode: bankCode,
        paymentQrCustomBankName: bank?.[1] ?? bankCode,
      },
    });
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

  const inputCls = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm lg:min-h-10";
  const previewQrReference = formatPrintPaymentReference(selected.options.paymentQrContentTemplate, "XX-000");

  useEffect(() => {
    if (!isPreviewFullscreen) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setIsPreviewFullscreen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [isPreviewFullscreen]);

  useLayoutEffect(() => {
    if (isPreviewFullscreen) previewSurfaceRef.current?.scrollTo({ top: 0, left: 0 });
  }, [isPreviewFullscreen]);
  const customQrAccountInvalid = selected.options.showPaymentQr && selected.options.paymentQrAccountSource === "custom"
    && (!selected.options.paymentQrCustomBankCode.trim() || !selected.options.paymentQrCustomAccountNumber.trim());
  const previewQrAccount = resolvePrintPaymentQrAccount(selected.options, {
    bankCode: "VCB",
    gateway: "Vietcombank",
    accountNumber: "0123456789",
    accountName: "LumaPOS",
  });

  return (
    <div className="px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+3rem)] md:p-6">
      <MobileDetailHeader
        backHref={Routes.Settings}
        backLabel={t("common.back")}
        title={t("printSettings.title")}
        subtitle={t("printSettings.settingsDesc")}
        flush
        className="-mx-3 -mt-3 mb-5 md:-mx-6 md:-mt-6"
      />

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border">
        {PRINT_DOC_TYPES.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => selectDocType(item)}
            aria-pressed={docType === item}
            className={cn(
              "min-h-11 shrink-0 border-b-2 px-4 py-2 text-sm font-semibold min-w-11",
              docType === item ? "border-primary-600 text-primary-600" : "border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200",
            )}
          >
            {t(`printSettings.docTypes.${item}`)}
          </button>
        ))}
      </div>

      <div className="space-y-6">
        <section className="space-y-4">
            <Panel>
              <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto]">
                <div className="min-w-0">
                  <span className="mb-1 block text-xs font-semibold text-slate-500">{t("printSettings.templateList")}</span>
                  <Select
                    aria-label={t("printSettings.templateList")}
                    value={selected.id}
                    onValueChange={(value) => { setSelectedId(value); setMsg(null); }}
                    options={visible.map((item) => ({
                      value: item.id,
                      label: item.name,
                      description: `${item.isDefault ? "★ · " : ""}${item.paperDefault.toUpperCase()} · ${item.isActive ? t("printSettings.active") : t("printSettings.inactive")}`,
                    }))}
                    rootClassName="w-full min-w-0"
                    wrapLabel
                  />
                </div>
                <button type="button" onClick={addTemplate} aria-label={t("common.add")} className="inline-flex min-h-11 shrink-0 self-end items-center justify-center gap-1.5 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white min-w-11 lg:min-h-10">
                  <Plus className="h-4 w-4" />
                  {t("common.add")}
                </button>
              </div>
              <div className="mt-4 grid items-end gap-3 border-t border-border-soft pt-4 sm:grid-cols-[minmax(220px,1fr)_auto]">
                <Field label={t("printSettings.templateName")}><input value={selected.name} onChange={(event) => patch({ name: event.target.value })} className={inputCls} /></Field>
                <Field label={t("printSettings.paperDefault")}>
                  <div className="flex gap-1.5">
                    {PAPER_SIZES.map((size) => (
                      <button
                        key={size}
                        type="button"
                        onClick={() => patch({ paperDefault: size })}
                        className={cn(
                          "min-h-11 rounded-lg border px-3 text-xs font-bold uppercase lg:min-h-10 min-w-11 lg:min-w-0",
                          selected.paperDefault === size ? "border-primary-600 bg-primary-600 text-white" : "border-border text-slate-600 dark:text-slate-300",
                        )}
                      >
                        {size}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <label className="mt-3 flex min-h-11 items-center gap-2 text-sm font-semibold lg:min-h-0 min-w-11 lg:min-w-0">
                <Checkbox checked={selected.isDefault} onChange={(event) => patch({ isDefault: event.target.checked })} />
                {t("printSettings.defaultTemplate")}
              </label>
            </Panel>

            {selected.options.showPaymentQr && (
              <Panel title={t("printSettings.qrSection")}>
                <Field label={t("printSettings.qrAccountSource")}>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {(["default", "custom"] as const).map((source) => (
                      <button
                        key={source}
                        type="button"
                        aria-pressed={selected.options.paymentQrAccountSource === source}
                        onClick={() => patch({ options: { ...DEFAULT_OPTIONS, ...selected.options, paymentQrAccountSource: source } })}
                        className={cn(
                          "min-h-11 rounded-lg border px-3 py-2 text-left text-sm font-semibold",
                          selected.options.paymentQrAccountSource === source
                            ? "border-primary-600 bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200"
                            : "border-border text-slate-600 dark:text-slate-300",
                        )}
                      >
                        {t(`printSettings.qrAccountSources.${source}`)}
                      </button>
                    ))}
                  </div>
                </Field>
                {selected.options.paymentQrAccountSource === "custom" && (
                  <div className="mt-3 grid gap-3 sm:grid-cols-2">
                    <Field label={t("printSettings.qrBank")}>
                      <Select
                        aria-label={t("printSettings.qrBank")}
                        value={selected.options.paymentQrCustomBankCode}
                        onValueChange={patchCustomQrBank}
                        options={VIETQR_BANKS.map(([value, label]) => ({ value, label, description: value }))}
                        placeholder={t("printSettings.qrBankPlaceholder")}
                      />
                    </Field>
                    <Field label={t("printSettings.qrAccountNumber")}>
                      <input inputMode="numeric" autoComplete="off" value={selected.options.paymentQrCustomAccountNumber} onChange={(event) => patchTextOption("paymentQrCustomAccountNumber", event.target.value)} className={inputCls} />
                    </Field>
                    <Field label={t("printSettings.qrAccountName")} className="sm:col-span-2">
                      <input value={selected.options.paymentQrCustomAccountName} onChange={(event) => patchTextOption("paymentQrCustomAccountName", event.target.value)} className={inputCls} />
                    </Field>
                  </div>
                )}
                <p className="mt-2 text-xs text-slate-500">{t("printSettings.qrAccountHint")}</p>
                {customQrAccountInvalid && <p className="mt-1 text-xs font-semibold text-er">{t("printSettings.qrCustomRequired")}</p>}
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <Field label={t("printSettings.qrTitle")}>
                    <input value={selected.options.paymentQrTitle} onChange={(event) => patchTextOption("paymentQrTitle", event.target.value)} placeholder={t("printSettings.qrTitlePlaceholder")} maxLength={100} className={inputCls} />
                  </Field>
                  <Field label={t("printSettings.qrContentTemplate")}>
                    <input value={selected.options.paymentQrContentTemplate} onChange={(event) => patchTextOption("paymentQrContentTemplate", event.target.value)} placeholder="{invoiceCode}" maxLength={100} className={inputCls} />
                  </Field>
                </div>
                <p className="mt-2 text-xs text-slate-500">{t("printSettings.qrContentHint", { invoiceCode: "{invoiceCode}" })}</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {QR_VISIBILITY_OPTIONS.map((key) => (
                    <label key={key} className="flex min-h-11 items-center gap-2 text-sm lg:min-h-0">
                      <Checkbox checked={selected.options[key]} onChange={(event) => patchOption(key, event.target.checked)} />
                      {t(`printSettings.qrVisibility.${key}`)}
                    </label>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title={t("printSettings.storeSection")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("printSettings.storeName")}><input value={selected.storeName} onChange={(event) => patch({ storeName: event.target.value })} className={inputCls} /></Field>
                <Field label={t("printSettings.storePhone")}><input value={selected.storePhone} onChange={(event) => patch({ storePhone: event.target.value })} className={inputCls} /></Field>
                <Field label={t("printSettings.storeAddress")} className="sm:col-span-2"><input value={selected.storeAddress} onChange={(event) => patch({ storeAddress: event.target.value })} className={inputCls} /></Field>
                <Field label={t("printSettings.storeTaxCode")}><input value={selected.storeTaxCode} onChange={(event) => patch({ storeTaxCode: event.target.value })} className={inputCls} /></Field>
              </div>
            </Panel>

            <Panel title={t("printSettings.optionsSection")}>
              <div className="space-y-4">
                {OPTION_GROUPS.map((group) => {
                  const options = group.options
                    .filter((key) => key !== "showBatchDebtSummary" || docType === "order")
                    .filter((key) => key !== "alwaysShowPaymentQr" || selected.options.showPaymentQr)
                    .filter((key) => !["showLineDiscountPercent", "showLineDiscountAmount"].includes(key) || selected.options.showLineDiscount);
                  if (options.length === 0) return null;
                  return (
                    <section key={group.key} aria-labelledby={`print-option-group-${group.key}`}>
                      <h3 id={`print-option-group-${group.key}`} className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">
                        {t(`printSettings.optionGroups.${group.key}`)}
                      </h3>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {options.map((key) => (
                          <label key={key} className="flex min-h-11 items-center gap-2 text-sm lg:min-h-0 min-w-11 lg:min-w-0">
                            <Checkbox checked={Boolean(selected.options[key])} onChange={(event) => patchOption(key, event.target.checked)} />
                            {t(`printSettings.toggles.${key}`)}
                          </label>
                        ))}
                      </div>
                      {group.key === "pricing" && selected.options.showTax && (
                        <Field label={t("printSettings.taxLabel")} className="mt-3 sm:max-w-md">
                          <input
                            value={selected.options.taxLabel}
                            placeholder={t("printSettings.taxLabelPlaceholder")}
                            onChange={(event) => patchTextOption("taxLabel", event.target.value)}
                            className={inputCls}
                            maxLength={80}
                          />
                        </Field>
                      )}
                    </section>
                  );
                })}
              </div>
            </Panel>

            {selected.options.showSignatures && (
              <Panel title={t("printSettings.signatureLabelsSection")}>
                <p className="mb-3 text-xs text-slate-500">{t("printSettings.signatureLabelsHint")}</p>
                <div className="grid gap-3 sm:grid-cols-3">
                  {SIGNATURE_LABELS.map((key) => (
                    <Field key={key} label={t(`printSettings.signatureLabels.${key}`)}>
                      <input
                        value={selected.options[key]}
                        placeholder={t(`printSettings.signaturePlaceholders.${key}`)}
                        onChange={(event) => patchTextOption(key, event.target.value)}
                        className={inputCls}
                        maxLength={80}
                      />
                    </Field>
                  ))}
                </div>
              </Panel>
            )}

            <Panel title={t("printSettings.footerNote")}>
              <PrintRichTextEditor key={selected.id} value={selected.footerNote} onChange={(footerNote) => patch({ footerNote })} />
            </Panel>

            <div className="sticky bottom-0 z-10 -mx-3 flex flex-wrap items-center gap-2 border-t border-border bg-surface/95 px-3 pt-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] backdrop-blur md:static md:mx-0 md:border-0 md:bg-transparent md:p-0 md:backdrop-blur-none">
              <button type="button" onClick={save} disabled={isPending || customQrAccountInvalid} aria-label={t("common.save")} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:opacity-50 min-w-11">
                {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("common.save")}
              </button>
              <button type="button" onClick={() => persisted && runAction(() => duplicatePrintTemplate(selected.id), "printSettings.duplicated")} disabled={!persisted || isPending} aria-label={t("printSettings.duplicate")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50 min-w-11">
                <Copy className="h-4 w-4" />
                {t("printSettings.duplicate")}
              </button>
              <button type="button" onClick={() => persisted && runAction(() => setDefaultPrintTemplate(selected.id), "printSettings.defaultSaved")} disabled={!persisted || selected.isDefault || isPending} aria-label={t("printSettings.setDefault")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50 min-w-11">
                <Star className="h-4 w-4" />
                {t("printSettings.setDefault")}
              </button>
              <button type="button" onClick={() => persisted && runAction(() => deactivatePrintTemplate(selected.id), "printSettings.deactivated")} disabled={!persisted || isPending} aria-label={t("printSettings.deactivate")} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-er/40 px-4 text-sm font-semibold text-er disabled:opacity-50 min-w-11">
                <EyeOff className="h-4 w-4" />
                {t("printSettings.deactivate")}
              </button>
              {msg && <span className={cn("text-sm font-medium", msg.ok ? "text-ok" : "text-er")}>{msg.text}</span>}
            </div>
        </section>

        <section
          role={isPreviewFullscreen ? "dialog" : undefined}
          aria-modal={isPreviewFullscreen ? true : undefined}
          aria-label={isPreviewFullscreen ? t("printSettings.preview") : undefined}
          className={cn(
            "min-w-0",
            isPreviewFullscreen && "fixed inset-0 z-[100] flex flex-col bg-surface p-3 sm:p-5",
          )}
        >
          <div className="mb-2 flex items-center justify-between gap-3">
            <h2 className="text-sm font-bold">{t("printSettings.preview")}</h2>
            <button
              type="button"
              onClick={() => setIsPreviewFullscreen((current) => !current)}
              className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2 lg:min-h-10"
              aria-label={t(isPreviewFullscreen ? "printSettings.exitFullscreenPreview" : "printSettings.fullscreenPreview")}
            >
              {isPreviewFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
              {t(isPreviewFullscreen ? "printSettings.exitFullscreenPreview" : "printSettings.fullscreenPreview")}
            </button>
          </div>
          <div className={cn(
            "overflow-auto rounded-card border border-border bg-slate-200 p-4 dark:bg-slate-950",
            isPreviewFullscreen ? "min-h-0 flex-1" : "max-h-[900px]",
          )} ref={previewSurfaceRef}>
            <div className="mx-auto w-max">
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
                  items={[{ id: "1", name: "Xi mang PCB40", sku: "HT40", unitName: "bao", quantity: 10, unitPrice: 95000, discount: 30000, lineDiscountMode: "pct", lineDiscountValue: 3, total: 920000 }]}
                  totals={[
                    { label: t("pos.subtotal"), value: 920000, kind: "subtotal" },
                    { label: t("pos.discount"), value: 20000, negative: true, kind: "discount" },
                    { label: t("pos.tax"), value: 72000, kind: "tax" },
                  ]}
                  grandTotalLabel={t("print.grandTotal")}
                  grandTotal={972000}
                  afterTotals={[{ label: t("print.paid"), value: 500000 }, { label: t("print.remaining"), value: 472000, bold: true }]}
                  paymentQr={previewQrAccount ? {
                    title: t("pos.sepay.title"),
                    qrImageUrl: buildVietQrImageUrl({ bankCode: previewQrAccount.bankCode, accountNumber: previewQrAccount.accountNumber, amount: 420000, reference: previewQrReference }),
                    bankLabel: t("pos.sepay.bank"),
                    accountLabel: t("pos.sepay.account"),
                    nameLabel: t("pos.sepay.name"),
                    referenceLabel: t("pos.sepay.reference"),
                    bankName: previewQrAccount.gateway ?? previewQrAccount.bankCode,
                    accountNumber: previewQrAccount.accountNumber,
                    accountName: previewQrAccount.accountName,
                    reference: previewQrReference,
                  } : null}
                  inWordsLabel={t("print.inWords")}
                  signatures={[t("print.buyerSign"), t("print.delivererSign"), t("print.sellerSign")]}
                  signHint={t("print.signHint")}
                  note={t("printSettings.previewNote")}
                  cols={{ index: t("print.index"), product: t("orders.cols.product"), unit: t("orders.cols.unit"), qty: t("orders.cols.qty"), unitPrice: t("orders.cols.unitPrice"), discount: t("orders.cols.discount"), lineTotal: t("orders.cols.lineTotal") }}
                />
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function Panel({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <div className="rounded-card border border-border bg-surface p-3 md:p-5">
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
