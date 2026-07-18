"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import {
  Ban,
  CirclePlus,
  Info,
  Printer,
  RotateCcw,
  Ruler,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import {
  Button,
  Field,
  Input,
  NumberInput,
  Section,
  SegmentedTabs,
  Select,
  Text,
} from "@/components/ui";
import styles from "./electrical-labels.module.css";

type ModuleCount = 1 | 2 | 3 | 4;
type ColorStyle = "none" | "stripe" | "border" | "fill" | "mono";

type Circuit = {
  id: string;
  name: string;
  modules: ModuleCount;
  quantity: number;
  color: string | null;
};

type LabelSettings = {
  labelHeight: number;
  clearance: number;
  uppercase: boolean;
  colorStyle: ColorStyle;
  profileId: string;
  customModuleWidth: number;
};

type DeviceProfile = {
  id: string;
  brand: string;
  series: string;
  moduleWidth: number | null;
};

const DEVICE_PROFILES: DeviceProfile[] = [
  { id: "panasonic-bbd", brand: "Panasonic", series: "BBD / BD", moduleWidth: 18 },
  { id: "schneider-acti9", brand: "Schneider", series: "Acti9 iC60", moduleWidth: 18 },
  { id: "schneider-easy9", brand: "Schneider", series: "Easy9", moduleWidth: 18 },
  { id: "abb-s200", brand: "ABB", series: "S200", moduleWidth: 17.5 },
  { id: "hager-mbn", brand: "Hager", series: "MBN", moduleWidth: 17.5 },
  { id: "legrand-dx3", brand: "Legrand", series: "DX³ ≤ 63 A", moduleWidth: 17.8 },
  { id: "chint-nxb", brand: "CHINT", series: "NXB / NB1", moduleWidth: 18 },
  { id: "ls-bkn", brand: "LS Electric", series: "BKN / BK63", moduleWidth: 18 },
  { id: "custom", brand: "—", series: "", moduleWidth: null },
];

const COLOR_PALETTES = [
  { id: "safety", colors: ["#dc2626", "#f59e0b", "#2563eb", "#059669"] },
  { id: "technical", colors: ["#e11d48", "#ea580c", "#0284c7", "#0f766e"] },
  { id: "soft", colors: ["#e8798f", "#e7a33e", "#5595d9", "#52a98c"] },
  { id: "bold", colors: ["#991b1b", "#a16207", "#1e40af", "#166534"] },
];

const DEFAULT_SETTINGS: LabelSettings = {
  labelHeight: 12,
  clearance: 1,
  uppercase: true,
  colorStyle: "none",
  profileId: "panasonic-bbd",
  customModuleWidth: 18,
};

const PAGE_INNER_WIDTH = 190;
const PAGE_INNER_HEIGHT = 273;
const LABEL_GAP = 2;
const STORAGE_KEY = "luma-pos-electrical-labels-v1";
const subscribeToNothing = () => () => {};

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getModuleWidth(settings: LabelSettings) {
  const profile = DEVICE_PROFILES.find((item) => item.id === settings.profileId);
  return profile?.moduleWidth ?? settings.customModuleWidth;
}

function displayName(name: string, modules: ModuleCount, uppercase: boolean) {
  const clean = name.trim() || "—";
  const value = uppercase ? clean.toLocaleUpperCase("vi-VN") : clean;
  const words = value.split(/\s+/);
  if (modules === 1 && words.length > 1) return words.join("\n");
  if (modules === 2 && value.length > 12 && words.length > 1) {
    const middle = Math.ceil(words.length / 2);
    return `${words.slice(0, middle).join(" ")}\n${words.slice(middle).join(" ")}`;
  }
  return value;
}

function fontSizeFor(name: string, modules: ModuleCount) {
  const length = name.trim().length;
  if (modules === 1) return length > 11 ? 6.2 : length > 7 ? 6.8 : 8;
  if (modules === 2) return length > 18 ? 7.2 : length > 12 ? 8 : 9.2;
  return length > 22 ? 8.5 : 10;
}

export function ElectricalLabelsClient() {
  const t = useTranslations("electricalLabels");
  const makeDefaults = React.useCallback((): Circuit[] => [
    { id: "main", name: t("defaults.main"), modules: 2, quantity: 2, color: null },
    { id: "induction", name: t("defaults.induction"), modules: 1, quantity: 4, color: null },
    { id: "lighting", name: t("defaults.lighting"), modules: 1, quantity: 6, color: null },
    { id: "water-heater", name: t("defaults.waterHeater"), modules: 1, quantity: 4, color: null },
  ], [t]);
  const [circuits, setCircuits] = React.useState<Circuit[]>(makeDefaults);
  const [settings, setSettings] = React.useState<LabelSettings>(DEFAULT_SETTINGS);
  const mounted = React.useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );
  const [hydrated, setHydrated] = React.useState(false);

  React.useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved) as {
            circuits?: Circuit[];
            settings?: Partial<LabelSettings>;
          };
          if (parsed.circuits?.length) setCircuits(parsed.circuits);
          if (parsed.settings) setSettings({ ...DEFAULT_SETTINGS, ...parsed.settings });
        }
      } catch {
        // Browser storage is optional; defaults remain usable.
      }
      setHydrated(true);
    }, 0);

    return () => window.clearTimeout(timer);
  }, []);

  React.useEffect(() => {
    if (!hydrated) return;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ circuits, settings }));
  }, [circuits, settings, hydrated]);

  const moduleWidth = getModuleWidth(settings);
  const activeProfile = DEVICE_PROFILES.find((item) => item.id === settings.profileId) ?? DEVICE_PROFILES[0];

  const pages = React.useMemo(() => {
    const labels = circuits.flatMap((circuit) =>
      Array.from({ length: Math.max(0, circuit.quantity) }, () => circuit),
    );
    const maxRows = Math.max(
      1,
      Math.floor((PAGE_INNER_HEIGHT + LABEL_GAP) / (settings.labelHeight + LABEL_GAP)),
    );
    const result: Circuit[][][] = [];
    let page: Circuit[][] = [];
    let row: Circuit[] = [];
    let usedWidth = 0;

    const pushRow = () => {
      if (!row.length) return;
      page.push(row);
      row = [];
      usedWidth = 0;
      if (page.length >= maxRows) {
        result.push(page);
        page = [];
      }
    };

    for (const label of labels) {
      const width = moduleWidth * label.modules - settings.clearance;
      const nextWidth = row.length ? usedWidth + LABEL_GAP + width : width;
      if (row.length && nextWidth > PAGE_INNER_WIDTH + 0.01) pushRow();
      row.push(label);
      usedWidth = row.length === 1 ? width : usedWidth + LABEL_GAP + width;
    }
    pushRow();
    if (page.length) result.push(page);
    return result.length ? result : [[[]]];
  }, [circuits, moduleWidth, settings]);

  const totalLabels = circuits.reduce((sum, circuit) => sum + circuit.quantity, 0);

  const updateCircuit = (id: string, patch: Partial<Circuit>) => {
    setCircuits((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const addCircuit = () => {
    setCircuits((current) => [
      ...current,
      { id: makeId(), name: t("defaults.socket"), modules: 1, quantity: 2, color: null },
    ]);
  };

  const resetAll = () => {
    setCircuits(makeDefaults());
    setSettings(DEFAULT_SETTINGS);
  };

  const applyPalette = (colors: string[]) => {
    setCircuits((current) => current.map((item, index) => ({
      ...item,
      color: colors[index % colors.length],
    })));
    setSettings((current) => ({
      ...current,
      colorStyle: current.colorStyle === "none" ? "stripe" : current.colorStyle,
    }));
  };

  const clearColors = () => {
    setCircuits((current) => current.map((item) => ({ ...item, color: null })));
    setSettings((current) => ({ ...current, colorStyle: "none" }));
  };

  const print = () => {
    document.body.classList.add("electrical-labels-printing");
    const cleanUp = () => {
      document.body.classList.remove("electrical-labels-printing");
      window.removeEventListener("afterprint", cleanUp);
    };
    window.addEventListener("afterprint", cleanUp);
    window.print();
    window.setTimeout(cleanUp, 60_000);
  };

  const profileOptions = DEVICE_PROFILES.map((profile) => ({
    value: profile.id,
    label: profile.id === "custom"
      ? t("customProfile")
      : `${profile.brand} · ${profile.series} · ${profile.moduleWidth} mm`,
  }));
  const moduleOptions = ([1, 2, 3, 4] as ModuleCount[]).map((count) => ({
    value: String(count),
    label: t("moduleOption", { count, width: (moduleWidth * count).toFixed(1) }),
  }));

  return (
    <>
      <div className="mx-auto grid w-full max-w-[1600px] gap-4 p-4 sm:p-6 2xl:grid-cols-[minmax(520px,0.82fr)_minmax(620px,1.18fr)]">
        <div className="min-w-0 space-y-4">
          <Section
            collapsible={false}
            title={t("deviceTitle")}
            description={t("deviceDescription")}
            action={(
              <div className="rounded-lg bg-primary-50 px-2.5 py-1 text-right dark:bg-primary-950/40">
                <div className="font-mono text-sm font-bold text-primary-700 dark:text-primary-300">{moduleWidth} mm</div>
                <div className="text-[9px] font-semibold uppercase tracking-wide text-primary-600">{t("perModule")}</div>
              </div>
            )}
          >
            <div className="space-y-4">
              <Field label={t("profileLabel")}>
                <Select
                  className="w-full"
                  value={settings.profileId}
                  options={profileOptions}
                  onValueChange={(profileId) => setSettings((current) => ({ ...current, profileId }))}
                />
              </Field>
              {settings.profileId === "custom" && (
                <Field label={t("customWidth")}>
                  <NumberInput
                    value={settings.customModuleWidth}
                    min={10}
                    max={30}
                    decimals={1}
                    thousandSeparator={false}
                    suffix="mm"
                    onChange={(value) => setSettings((current) => ({
                      ...current,
                      customModuleWidth: value ?? 18,
                    }))}
                  />
                </Field>
              )}
              <div className="flex gap-2 rounded-lg bg-surface-2 p-3 text-xs text-slate-500 dark:text-slate-400">
                <Info className="mt-0.5 size-4 shrink-0 text-primary-600" />
                <p>{t("moduleHint", { width: moduleWidth })}</p>
              </div>
            </div>
          </Section>

          <Section
            collapsible={false}
            title={t("circuitsTitle")}
            description={t("circuitsDescription")}
            action={(
              <Button variant="ghost" size="sm" onClick={resetAll}>
                <RotateCcw />
                {t("reset")}
              </Button>
            )}
          >
            <div className="space-y-3">
              {circuits.map((circuit, index) => (
                <div
                  className="grid gap-3 rounded-xl border border-border bg-surface-2 p-3 sm:grid-cols-[44px_minmax(0,1.35fr)_minmax(0,1fr)_84px_32px] sm:items-end"
                  key={circuit.id}
                >
                  <div className="flex items-center gap-2 sm:block sm:self-center">
                    <span className="font-mono text-[10px] font-semibold text-slate-400">{String(index + 1).padStart(2, "0")}</span>
                    <CircuitColorPicker
                      color={circuit.color}
                      chooseLabel={t("colorFor", { name: circuit.name })}
                      clearLabel={t("clearColor", { name: circuit.name })}
                      onChange={(color) => {
                        updateCircuit(circuit.id, { color });
                        if (color) {
                          setSettings((current) => ({
                            ...current,
                            colorStyle: current.colorStyle === "none" ? "stripe" : current.colorStyle,
                          }));
                        }
                      }}
                    />
                  </div>
                  <Field label={t("circuitName")} className="min-w-0">
                    <Input
                      value={circuit.name}
                      maxLength={32}
                      onChange={(event) => updateCircuit(circuit.id, { name: event.target.value })}
                    />
                  </Field>
                  <Field label={t("modules")} className="min-w-0">
                    <Select
                      className="w-full"
                      value={String(circuit.modules)}
                      options={moduleOptions}
                      onValueChange={(value) => updateCircuit(circuit.id, { modules: Number(value) as ModuleCount })}
                    />
                  </Field>
                  <Field label={t("quantity")} className="min-w-0">
                    <NumberInput
                      className="min-w-0 px-2"
                      value={circuit.quantity}
                      min={1}
                      max={99}
                      thousandSeparator={false}
                      onChange={(value) => updateCircuit(circuit.id, { quantity: value ?? 1 })}
                    />
                  </Field>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={t("removeCircuit", { name: circuit.name })}
                    onClick={() => setCircuits((current) => current.filter((item) => item.id !== circuit.id))}
                    className="text-slate-400 hover:text-red-600"
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="outline" block onClick={addCircuit}>
                <CirclePlus />
                {t("addCircuit")}
              </Button>
            </div>
          </Section>

          <Section collapsible={false} title={t("appearanceTitle")} description={t("appearanceDescription")}>
            <div className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label={t("labelHeight")}>
                  <NumberInput
                    value={settings.labelHeight}
                    min={8}
                    max={18}
                    suffix="mm"
                    thousandSeparator={false}
                    onChange={(value) => setSettings((current) => ({ ...current, labelHeight: value ?? 12 }))}
                  />
                </Field>
                <Field label={t("clearance")}>
                  <NumberInput
                    value={settings.clearance}
                    min={0}
                    max={2}
                    decimals={1}
                    suffix="mm"
                    thousandSeparator={false}
                    onChange={(value) => setSettings((current) => ({ ...current, clearance: value ?? 1 }))}
                  />
                </Field>
              </div>
              <Field label={t("colorStyle")}>
                <SegmentedTabs
                  className="rounded-xl border border-border bg-surface-2 p-1"
                  value={settings.colorStyle}
                  onChange={(colorStyle) => setSettings((current) => ({ ...current, colorStyle }))}
                  items={([
                    ["none", t("styles.none")],
                    ["stripe", t("styles.stripe")],
                    ["border", t("styles.border")],
                    ["fill", t("styles.fill")],
                    ["mono", t("styles.mono")],
                  ] as const).map(([id, label]) => ({ id, label }))}
                />
              </Field>
              <Field label={t("quickPalette")}>
                <div className="mb-2 grid grid-cols-1">
                  <button
                    type="button"
                    onClick={clearColors}
                    className="flex items-center justify-center gap-2 rounded-xl border border-border bg-surface p-2.5 text-xs font-semibold text-slate-600 transition-colors hover:border-primary-300 hover:text-primary-700 dark:text-slate-300"
                  >
                    <Ban className="size-4" />
                    {t("noColor")}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {COLOR_PALETTES.map((palette) => (
                    <button
                      type="button"
                      key={palette.id}
                      onClick={() => applyPalette(palette.colors)}
                      className="rounded-xl border border-border bg-surface p-2 text-xs font-medium text-slate-600 transition-colors hover:border-primary-300 hover:text-primary-700 dark:text-slate-300"
                    >
                      <span className="mb-1.5 flex justify-center gap-1" aria-hidden="true">
                        {palette.colors.map((color) => (
                          <i className="size-3 rounded-full" style={{ background: color }} key={color} />
                        ))}
                      </span>
                      {t(`palettes.${palette.id}`)}
                    </button>
                  ))}
                </div>
              </Field>
              <label className="flex cursor-pointer items-center justify-between gap-3 rounded-xl border border-border bg-surface-2 p-3">
                <span>
                  <Text as="span" weight="medium">{t("uppercase")}</Text>
                  <Text as="span" variant="muted" size="xs" className="mt-0.5 block">{t("uppercaseHint")}</Text>
                </span>
                <input
                  type="checkbox"
                  className="size-5 accent-primary-600"
                  checked={settings.uppercase}
                  onChange={(event) => setSettings((current) => ({ ...current, uppercase: event.target.checked }))}
                />
              </label>
            </div>
          </Section>
        </div>

        <div className="min-w-0">
          <div className="overflow-hidden rounded-card border border-border bg-surface shadow-e1 2xl:sticky 2xl:top-[74px]">
            <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-5">
              <div>
                <Text as="h2" weight="bold">{t("preview")}</Text>
                <Text as="p" variant="muted" size="xs" className="mt-0.5">
                  {t("previewSummary", { pages: pages.length, labels: totalLabels })}
                </Text>
              </div>
              <div className="flex-1" />
              <span className="rounded-lg bg-surface-2 px-2.5 py-1.5 font-mono text-[11px] font-semibold text-slate-500">
                {activeProfile.brand} · {moduleWidth} mm
              </span>
              <Button onClick={print} disabled={totalLabels === 0}>
                <Printer />
                {t("print")}
              </Button>
            </div>
            <div className="m-4 flex gap-2 rounded-xl border border-primary-200 bg-primary-50 p-3 text-xs text-primary-800 dark:border-primary-900 dark:bg-primary-950/30 dark:text-primary-200">
              <Ruler className="mt-0.5 size-4 shrink-0" />
              <p>{t("printHint")}</p>
            </div>
            <div className="max-h-[calc(100dvh-14rem)] overflow-auto bg-surface-2 p-4 sm:p-6">
              {pages.map((page, pageIndex) => (
                <div className="mx-auto mb-6 w-max" key={pageIndex}>
                  <div className="mb-1.5 font-mono text-[9px] font-bold uppercase tracking-widest text-slate-400">
                    {t("pageNumber", { page: pageIndex + 1 })}
                  </div>
                  <PrintPage page={page} settings={settings} moduleWidth={moduleWidth} pageIndex={pageIndex} preview />
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {mounted && createPortal(
        <div className="electrical-labels-print-root" aria-hidden="true">
          {pages.map((page, pageIndex) => (
            <PrintPage page={page} settings={settings} moduleWidth={moduleWidth} pageIndex={pageIndex} key={pageIndex} />
          ))}
        </div>,
        document.body,
      )}
    </>
  );
}

function CircuitColorPicker({
  color,
  chooseLabel,
  clearLabel,
  onChange,
}: {
  color: string | null;
  chooseLabel: string;
  clearLabel: string;
  onChange: (color: string | null) => void;
}) {
  return (
    <div className="relative mt-1 w-fit">
      <label
        className="relative grid size-9 cursor-pointer place-items-center overflow-hidden rounded-lg border border-border bg-surface shadow-sm transition-colors hover:border-primary-400 focus-within:ring-2 focus-within:ring-primary-500/30"
        title={chooseLabel}
      >
        {color ? (
          <span className="absolute inset-1 rounded-md" style={{ backgroundColor: color }} aria-hidden="true" />
        ) : (
          <Ban className="size-4 text-slate-400" aria-hidden="true" />
        )}
        <input
          type="color"
          value={color ?? "#0f766e"}
          onChange={(event) => onChange(event.target.value)}
          aria-label={chooseLabel}
          className="absolute inset-0 cursor-pointer opacity-0"
        />
      </label>
      {color && (
        <button
          type="button"
          aria-label={clearLabel}
          title={clearLabel}
          onClick={() => onChange(null)}
          className="absolute -right-1.5 -top-1.5 z-10 grid size-4 place-items-center rounded-full border border-border bg-surface text-[10px] font-bold leading-none text-slate-500 shadow-sm hover:border-red-300 hover:text-red-600"
        >
          ×
        </button>
      )}
    </div>
  );
}

function PrintPage({
  page,
  settings,
  moduleWidth,
  pageIndex,
  preview = false,
}: {
  page: Circuit[][];
  settings: LabelSettings;
  moduleWidth: number;
  pageIndex: number;
  preview?: boolean;
}) {
  return (
    <section className={`${styles.a4Page} ${preview ? styles.previewPage : ""}`} aria-label={`A4 ${pageIndex + 1}`}>
      <div className={styles.sheetInner}>
        {page.map((row, rowIndex) => (
          <div
            className={styles.labelRow}
            style={{
              height: `${settings.labelHeight}mm`,
              marginBottom: rowIndex === page.length - 1 ? 0 : `${LABEL_GAP}mm`,
            }}
            key={rowIndex}
          >
            {row.map((label, labelIndex) => {
              const width = moduleWidth * label.modules - settings.clearance;
              const colorStyle = label.color ? settings.colorStyle : "none";
              return (
                <div
                  className={`${styles.printLabel} ${styles[colorStyle] ?? ""}`}
                  style={{
                    width: `${width}mm`,
                    height: `${settings.labelHeight}mm`,
                    "--label-accent": label.color ?? "transparent",
                    "--label-font-size": `${fontSizeFor(label.name, label.modules)}pt`,
                  } as React.CSSProperties}
                  key={`${label.id}-${labelIndex}`}
                >
                  <span>{displayName(label.name, label.modules, settings.uppercase)}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </section>
  );
}
