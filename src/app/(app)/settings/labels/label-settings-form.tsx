"use client";

import { useMemo, useState, useTransition, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ArrowLeft, Copy, EyeOff, Loader2, Plus, Save, Star } from "lucide-react";
import {
  deactivateLabelTemplate,
  duplicateLabelTemplate,
  saveLabelTemplate,
  setDefaultLabelTemplate,
} from "@/lib/actions/label-templates";
import { DEFAULT_LABEL_TEMPLATE, type LabelTemplate } from "@/lib/labels/template-shared";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const TOGGLES = ["showName", "showSku", "showPrice", "showUnit", "showBarcodeText", "showStoreName"] as const;

const LABEL_PRESETS = [
  { key: "40x30", widthMm: 40, heightMm: 30, columns: 3, gapMm: 2, barcodeHeightMm: 10, barcodeQuietMm: 2, fontScale: 1 },
  { key: "50x30", widthMm: 50, heightMm: 30, columns: 2, gapMm: 3, barcodeHeightMm: 11, barcodeQuietMm: 2, fontScale: 1 },
  { key: "35x22", widthMm: 35, heightMm: 22, columns: 4, gapMm: 2, barcodeHeightMm: 8, barcodeQuietMm: 1.5, fontScale: 0.9 },
] as const;

export function LabelSettingsForm({ templates }: { templates: LabelTemplate[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [drafts, setDrafts] = useState<LabelTemplate[]>(templates);
  const [selectedId, setSelectedId] = useState(() => templates[0]?.id ?? DEFAULT_LABEL_TEMPLATE.id);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const selected = drafts.find((template) => template.id === selectedId) ?? drafts[0] ?? DEFAULT_LABEL_TEMPLATE;
  const persisted = !selected.id.startsWith("draft-") && !selected.id.startsWith("default-");
  const activeTemplates = useMemo(() => drafts.filter((template) => template.isActive), [drafts]);

  function patch(value: Partial<LabelTemplate>) {
    setDrafts((current) => current.map((item) => item.id === selected.id ? { ...item, ...value } : item));
  }

  function addTemplate() {
    const id = `draft-label-${Date.now()}`;
    const next: LabelTemplate = {
      ...DEFAULT_LABEL_TEMPLATE,
      id,
      name: t("labelSettings.newTemplateName"),
      isDefault: activeTemplates.length === 0,
      sortOrder: drafts.length * 10,
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
      () => saveLabelTemplate({
        id: persisted ? selected.id : undefined,
        name: selected.name,
        widthMm: selected.widthMm,
        heightMm: selected.heightMm,
        columns: selected.columns,
        gapMm: selected.gapMm,
        barcodeType: selected.barcodeType,
        showName: selected.showName,
        showSku: selected.showSku,
        showPrice: selected.showPrice,
        showUnit: selected.showUnit,
        showBarcodeText: selected.showBarcodeText,
        showStoreName: selected.showStoreName,
        barcodeHeightMm: selected.barcodeHeightMm,
        barcodeQuietMm: selected.barcodeQuietMm,
        fontScale: selected.fontScale,
        isDefault: selected.isDefault,
        isActive: selected.isActive,
        sortOrder: selected.sortOrder,
      }),
      "labelSettings.saved",
      (data) => {
        const nextId = (data as { id?: string } | undefined)?.id;
        if (!nextId || nextId === oldId) return;
        setDrafts((current) => current.map((item) => item.id === oldId ? { ...item, id: nextId } : item));
        setSelectedId(nextId);
      },
    );
  }

  const inputCls = "h-10 w-full rounded-lg border border-border bg-surface px-3 text-sm";

  return (
    <div className="p-4 sm:p-6">
      <div className="mb-5 flex items-center gap-3">
        <Link href={Routes.Settings} className="grid h-10 w-10 place-items-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("common.back")}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-2xl font-bold">{t("labelSettings.title")}</h1>
          <p className="text-sm text-slate-500">{t("labelSettings.settingsDesc")}</p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
        <aside className="rounded-card border border-border bg-surface">
          <div className="flex items-center justify-between border-b border-border-soft p-3">
            <div className="text-sm font-bold">{t("labelSettings.templateList")}</div>
            <button type="button" onClick={addTemplate} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-primary-600 px-3 text-xs font-semibold text-white">
              <Plus className="h-3.5 w-3.5" />
              {t("common.add")}
            </button>
          </div>
          <div className="max-h-[620px] overflow-y-auto p-2">
            {drafts.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => { setSelectedId(item.id); setMsg(null); }}
                className={cn(
                  "mb-1 w-full rounded-lg border px-3 py-2.5 text-left text-sm transition",
                  selected.id === item.id ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-950/40 dark:text-primary-200" : "border-transparent hover:bg-surface-2",
                  !item.isActive && "opacity-60",
                )}
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="min-w-0 truncate font-semibold">{item.name}</span>
                  {item.isDefault && <Star className="h-3.5 w-3.5 shrink-0 fill-current text-primary-600" />}
                </span>
                <span className="mt-1 block text-xs text-slate-500">
                  {item.widthMm}x{item.heightMm}mm · {item.columns} {t("labelSettings.columnsShort")} · {item.isActive ? t("labelSettings.active") : t("labelSettings.inactive")}
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="space-y-4">
            <Panel>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t("labelSettings.templateName")}><input value={selected.name} onChange={(event) => patch({ name: event.target.value })} className={inputCls} /></Field>
                <Field label={t("labelSettings.sortOrder")}><NumberInput value={selected.sortOrder} min={0} max={9999} onChange={(value) => patch({ sortOrder: value })} className={inputCls} /></Field>
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm font-semibold">
                <input type="checkbox" checked={selected.isDefault} onChange={(event) => patch({ isDefault: event.target.checked })} />
                {t("labelSettings.defaultTemplate")}
              </label>
            </Panel>

            <Panel title={t("labelSettings.sizeSection")}>
              <div className="mb-3 flex flex-wrap gap-2">
                {LABEL_PRESETS.map((preset) => (
                  <button
                    key={preset.key}
                    type="button"
                    onClick={() => patch(preset)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs font-semibold hover:bg-surface-2"
                  >
                    {preset.widthMm}x{preset.heightMm}mm
                  </button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-4">
                <Field label={t("labelSettings.widthMm")}><NumberInput value={selected.widthMm} min={10} max={120} step={1} onChange={(value) => patch({ widthMm: value })} className={inputCls} /></Field>
                <Field label={t("labelSettings.heightMm")}><NumberInput value={selected.heightMm} min={8} max={80} step={1} onChange={(value) => patch({ heightMm: value })} className={inputCls} /></Field>
                <Field label={t("labelSettings.columns")}><NumberInput value={selected.columns} min={1} max={6} step={1} onChange={(value) => patch({ columns: Math.round(value) })} className={inputCls} /></Field>
                <Field label={t("labelSettings.gapMm")}><NumberInput value={selected.gapMm} min={0} max={20} step={0.5} onChange={(value) => patch({ gapMm: value })} className={inputCls} /></Field>
                <Field label={t("labelSettings.barcodeHeightMm")}><NumberInput value={selected.barcodeHeightMm} min={6} max={40} step={0.5} onChange={(value) => patch({ barcodeHeightMm: value })} className={inputCls} /></Field>
                <Field label={t("labelSettings.barcodeQuietMm")}><NumberInput value={selected.barcodeQuietMm} min={0} max={10} step={0.5} onChange={(value) => patch({ barcodeQuietMm: value })} className={inputCls} /></Field>
                <Field label={t("labelSettings.fontScale")}><NumberInput value={selected.fontScale} min={0.75} max={1.5} step={0.05} onChange={(value) => patch({ fontScale: value })} className={inputCls} /></Field>
              </div>
            </Panel>

            <Panel title={t("labelSettings.contentSection")}>
              <div className="grid gap-2 sm:grid-cols-2">
                {TOGGLES.map((key) => (
                  <label key={key} className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={Boolean(selected[key])} onChange={(event) => patch({ [key]: event.target.checked })} />
                    {t(`labelSettings.toggles.${key}`)}
                  </label>
                ))}
              </div>
            </Panel>

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" onClick={save} disabled={pending} className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white disabled:opacity-50">
                {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                {t("common.save")}
              </button>
              <button type="button" onClick={() => persisted && runAction(() => duplicateLabelTemplate(selected.id), "labelSettings.duplicated")} disabled={!persisted || pending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50">
                <Copy className="h-4 w-4" />
                {t("labelSettings.duplicate")}
              </button>
              <button type="button" onClick={() => persisted && runAction(() => setDefaultLabelTemplate(selected.id), "labelSettings.defaultSaved")} disabled={!persisted || selected.isDefault || pending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold disabled:opacity-50">
                <Star className="h-4 w-4" />
                {t("labelSettings.setDefault")}
              </button>
              <button type="button" onClick={() => persisted && runAction(() => deactivateLabelTemplate(selected.id), "labelSettings.deactivated")} disabled={!persisted || selected.isDefault || pending} className="inline-flex h-10 items-center gap-2 rounded-lg border border-er/40 px-4 text-sm font-semibold text-er disabled:opacity-50">
                <EyeOff className="h-4 w-4" />
                {t("labelSettings.deactivate")}
              </button>
              {msg && <span className={cn("text-sm font-medium", msg.ok ? "text-ok" : "text-er")}>{msg.text}</span>}
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs font-semibold text-slate-500">{t("labelSettings.preview")}</p>
            <div className="rounded-card border border-border bg-slate-200 p-4 dark:bg-slate-950">
              <div
                className="overflow-hidden border border-slate-300 bg-white p-[2mm] text-slate-950 shadow-sm"
                style={{ width: `${selected.widthMm}mm`, height: `${selected.heightMm}mm` }}
              >
                {selected.showStoreName && <div className="truncate text-center font-bold uppercase tracking-wide text-slate-500" style={{ fontSize: `${6.5 * selected.fontScale}px` }}>LumaPOS</div>}
                {selected.showName && <div className="line-clamp-2 font-bold leading-tight" style={{ fontSize: `${10 * selected.fontScale}px` }}>Xi mang PCB40</div>}
                <div className="mt-[1mm] flex items-center justify-between gap-1" style={{ fontSize: `${8 * selected.fontScale}px` }}>
                  {selected.showSku && <span className="truncate font-mono text-slate-500">XM-PCB40</span>}
                  {selected.showUnit && <span className="shrink-0 text-slate-500">bao</span>}
                  {selected.showPrice && <span className="shrink-0 font-semibold">92.000 ₫</span>}
                </div>
                <div className="mt-[1mm] flex items-stretch overflow-hidden bg-white" style={{ height: `${selected.barcodeHeightMm}mm`, paddingInline: `${selected.barcodeQuietMm}mm` }}>
                  {Array.from({ length: 42 }).map((_, index) => (
                    <span key={index} className={index % 2 === 0 ? "bg-slate-950" : "bg-white"} style={{ width: `${index % 5 === 0 ? 3 : 1}px` }} />
                  ))}
                </div>
                {selected.showBarcodeText && (
                  <div className="mt-[1mm] flex items-center justify-between gap-1 font-medium text-slate-600" style={{ fontSize: `${7 * selected.fontScale}px` }}>
                    <span>{t("products.labels.barcodeValue")}</span>
                    <span className="truncate font-mono text-slate-950">893000000001</span>
                  </div>
                )}
              </div>
              <p className="mt-3 text-xs text-slate-500">
                {selected.widthMm}x{selected.heightMm}mm · {selected.columns} {t("labelSettings.columnsShort")} · {selected.gapMm}mm
              </p>
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

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span>
      {children}
    </label>
  );
}

function NumberInput({
  value,
  onChange,
  className,
  min,
  max,
  step = 1,
}: {
  value: number;
  onChange: (value: number) => void;
  className?: string;
  min?: number;
  max?: number;
  step?: number;
}) {
  return (
    <input
      type="number"
      value={value}
      min={min}
      max={max}
      step={step}
      onChange={(event) => onChange(Number(event.target.value))}
      className={className}
    />
  );
}
