"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  CircleAlert,
  Copy,
  DoorOpen,
  Layers3,
  Palette,
  Plus,
  ReceiptText,
  Ruler,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SKIRT_HEIGHT,
  DEFAULT_WASTE,
  FLOOR_TILE_SIZES,
  SKIRT_TILE_SIZES,
  WALL_TILE_SIZES,
  calculateRoom,
  calculateTotals,
  tileSizeLabel,
  type Opening,
  type RoomCalculation,
  type TileRoom,
  type WallType,
} from "./tile-calculator-model";
import { ToolPageHeader } from "./tool-page-header";

type CopyState = "idle" | "copied" | "error";
type Translator = ReturnType<typeof useTranslations>;

export function TileCalculator() {
  const t = useTranslations("tileCalculator");
  const toolsT = useTranslations("toolsCenter");
  const locale = useLocale();
  const [rooms, setRooms] = useState<TileRoom[]>(() => createInitialRooms(t));
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const calculations = useMemo(() => rooms.map(calculateRoom), [rooms]);
  const totals = useMemo(() => calculateTotals(calculations), [calculations]);
  const number = useMemo(() => new Intl.NumberFormat(locale, {
    maximumFractionDigits: 2,
  }), [locale]);
  const currency = useMemo(() => new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }), [locale]);

  function patchRoom(roomId: string, patch: Partial<TileRoom>) {
    setRooms((current) => current.map((room) => room.id === roomId ? { ...room, ...patch } : room));
  }

  function addRoom() {
    const roomNumber = rooms.length + 1;
    setRooms((current) => [
      ...current,
      createRoom(makeId("room"), t("roomDefaultName", { number: roomNumber })),
    ]);
  }

  function removeRoom(roomId: string) {
    setRooms((current) => current.length > 1 ? current.filter((room) => room.id !== roomId) : current);
  }

  function addOpening(roomId: string) {
    setRooms((current) => current.map((room) => room.id === roomId ? {
      ...room,
      openings: [
        ...room.openings,
        {
          id: makeId("opening"),
          name: t("openingDefaultName", { number: room.openings.length + 1 }),
          width: 0.9,
          height: 2.1,
        },
      ],
    } : room));
  }

  function patchOpening(roomId: string, openingId: string, patch: Partial<Opening>) {
    setRooms((current) => current.map((room) => room.id === roomId ? {
      ...room,
      openings: room.openings.map((opening) => opening.id === openingId ? { ...opening, ...patch } : opening),
    } : room));
  }

  function removeOpening(roomId: string, openingId: string) {
    setRooms((current) => current.map((room) => room.id === roomId ? {
      ...room,
      openings: room.openings.filter((opening) => opening.id !== openingId),
    } : room));
  }

  function addWallType(roomId: string) {
    setRooms((current) => current.map((room) => room.id === roomId ? {
      ...room,
      wallTypes: [
        ...room.wallTypes,
        {
          id: makeId("wall-type"),
          name: t("wallTypeDefaultName", { number: room.wallTypes.length + 1 }),
          rows: 0,
        },
      ],
    } : room));
  }

  function patchWallType(roomId: string, typeId: string, patch: Partial<WallType>) {
    setRooms((current) => current.map((room) => room.id === roomId ? {
      ...room,
      wallTypes: room.wallTypes.map((type) => type.id === typeId ? { ...type, ...patch } : type),
    } : room));
  }

  function removeWallType(roomId: string, typeId: string) {
    setRooms((current) => current.map((room) => room.id === roomId ? {
      ...room,
      wallTypes: room.wallTypes.filter((type) => type.id !== typeId),
    } : room));
  }

  async function copySummary() {
    const text = buildSummaryText(rooms, calculations, t, number, currency);
    try {
      await writeClipboard(text);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  }

  return (
    <div className="min-h-full bg-canvas">
      <ToolPageHeader
        eyebrow={toolsT("breadcrumbs.calculation")}
        title={t("title")}
        description={t("description")}
        actions={(
          <Button type="button" variant="outline" size="sm" onClick={copySummary}>
            {copyState === "copied" ? <Check /> : copyState === "error" ? <CircleAlert /> : <Copy />}
            {copyState === "copied" ? t("copied") : t("copySummary")}
          </Button>
        )}
      />

      <main className="mx-auto w-full max-w-[94rem] px-4 py-5 sm:px-6 sm:py-7">
        {copyState === "error" && (
          <p role="alert" className="mb-4 text-sm font-medium text-er">{t("copyFailed")}</p>
        )}

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <section aria-label={t("rooms")} className="min-w-0 space-y-4">
            {rooms.map((room, index) => (
              <RoomCard
                key={room.id}
                room={room}
                calculation={calculations[index]}
                index={index}
                number={number}
                currency={currency}
                canRemove={rooms.length > 1}
                onPatch={(patch) => patchRoom(room.id, patch)}
                onRemove={() => removeRoom(room.id)}
                onAddOpening={() => addOpening(room.id)}
                onPatchOpening={(openingId, patch) => patchOpening(room.id, openingId, patch)}
                onRemoveOpening={(openingId) => removeOpening(room.id, openingId)}
                onAddWallType={() => addWallType(room.id)}
                onPatchWallType={(typeId, patch) => patchWallType(room.id, typeId, patch)}
                onRemoveWallType={(typeId) => removeWallType(room.id, typeId)}
              />
            ))}

            <button
              type="button"
              onClick={addRoom}
              className="group flex w-full items-center justify-center gap-2 rounded-card border border-dashed border-primary-300 bg-primary-50/40 px-4 py-4 text-sm font-semibold text-primary-700 transition hover:border-primary-500 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 dark:border-primary-800 dark:bg-primary-950/20 dark:text-primary-300 dark:hover:bg-primary-950/35"
            >
              <Plus className="size-4 transition-transform group-hover:rotate-90" />
              {t("addRoom")}
            </button>
          </section>

          <ProjectSummary
            rooms={rooms}
            calculations={calculations}
            totals={totals}
            number={number}
            currency={currency}
          />
        </div>
      </main>
    </div>
  );
}

function RoomCard({
  room,
  calculation,
  index,
  number,
  currency,
  canRemove,
  onPatch,
  onRemove,
  onAddOpening,
  onPatchOpening,
  onRemoveOpening,
  onAddWallType,
  onPatchWallType,
  onRemoveWallType,
}: {
  room: TileRoom;
  calculation: RoomCalculation;
  index: number;
  number: Intl.NumberFormat;
  currency: Intl.NumberFormat;
  canRemove: boolean;
  onPatch: (patch: Partial<TileRoom>) => void;
  onRemove: () => void;
  onAddOpening: () => void;
  onPatchOpening: (openingId: string, patch: Partial<Opening>) => void;
  onRemoveOpening: (openingId: string) => void;
  onAddWallType: () => void;
  onPatchWallType: (typeId: string, patch: Partial<WallType>) => void;
  onRemoveWallType: (typeId: string) => void;
}) {
  const t = useTranslations("tileCalculator");
  const wallVisible = room.height > 0 || room.wallMultiType;

  return (
    <article className="overflow-hidden rounded-card border border-border bg-surface shadow-e1">
      <header className="flex items-center gap-3 border-b border-border-soft bg-surface-2/70 px-4 py-3.5 sm:px-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary-100 font-mono text-xs font-bold text-primary-700 dark:bg-primary-950/60 dark:text-primary-300">
          {String(index + 1).padStart(2, "0")}
        </span>
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("roomName")}</span>
          <Input
            value={room.name}
            onChange={(event) => onPatch({ name: event.target.value })}
            placeholder={t("roomNamePlaceholder")}
            className="h-9 border-transparent bg-transparent px-2 text-base font-semibold hover:border-border hover:bg-surface focus:bg-surface"
          />
        </label>
        <Button
          type="button"
          variant="ghost"
          size="iconSm"
          disabled={!canRemove}
          onClick={onRemove}
          aria-label={t("removeRoom", { name: room.name })}
          title={t("deleteRoom")}
          className="text-slate-400 hover:bg-er-soft hover:text-er"
        >
          <Trash2 />
        </Button>
      </header>

      <div className="space-y-6 p-4 sm:p-5">
        <CalculatorSection icon={<Ruler />} title={t("dimensions")} description={t("dimensionsHint")}>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField id={`${room.id}-length`} label={t("length")} value={room.length} suffix="m" onChange={(length) => onPatch({ length })} />
            <NumberField id={`${room.id}-width`} label={t("width")} value={room.width} suffix="m" onChange={(width) => onPatch({ width })} />
            <NumberField id={`${room.id}-height`} label={t("height")} hint={t("optional")} value={room.height} suffix="m" onChange={(height) => onPatch({ height })} />
          </div>
        </CalculatorSection>

        <CalculatorSection icon={<Layers3 />} title={t("materials")} description={t("materialsHint")}>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            <TileSelect
              id={`${room.id}-floor-tile`}
              label={t("floorTile")}
              sizes={FLOOR_TILE_SIZES}
              value={room.floorTileSize}
              onChange={(floorTileSize) => onPatch({ floorTileSize })}
            />
            {wallVisible && (
              <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
                <TileSelect
                  id={`${room.id}-wall-tile`}
                  label={t("wallTile")}
                  sizes={WALL_TILE_SIZES}
                  value={room.wallTileSize}
                  onChange={(wallTileSize) => onPatch({ wallTileSize })}
                />
                <SelectField
                  id={`${room.id}-orientation`}
                  label={t("orientation")}
                  value={room.wallOrientation}
                  options={[
                    { value: "horizontal", label: t("horizontal") },
                    { value: "vertical", label: t("vertical") },
                  ]}
                  onChange={(wallOrientation) => onPatch({ wallOrientation: wallOrientation as TileRoom["wallOrientation"] })}
                />
              </div>
            )}
            {room.skirtEnabled && (
              <TileSelect
                id={`${room.id}-skirt-tile`}
                label={t("skirtSourceTile")}
                sizes={SKIRT_TILE_SIZES}
                value={room.skirtSourceTile}
                onChange={(skirtSourceTile) => onPatch({ skirtSourceTile })}
              />
            )}
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            <ToggleRow
              label={t("skirtEnabled")}
              description={t("skirtEnabledHint")}
              checked={room.skirtEnabled}
              onChange={(skirtEnabled) => onPatch({ skirtEnabled })}
            />
            <ToggleRow
              label={t("multiWall")}
              description={t("multiWallHint")}
              checked={room.wallMultiType}
              onChange={(wallMultiType) => onPatch({ wallMultiType })}
            />
          </div>
        </CalculatorSection>

        <CalculatorSection icon={<ReceiptText />} title={t("pricing")} description={t("pricingHint")}>
          <div className="grid gap-4 lg:grid-cols-3">
            <PriceGroup title={t("floor")}>
              <NumberField id={`${room.id}-floor-price`} label={t("pricePerSquareMeter")} value={room.floorPrice} suffix="₫" step={1000} onChange={(floorPrice) => onPatch({ floorPrice })} />
              <NumberField id={`${room.id}-floor-waste`} label={t("waste")} value={room.floorWaste} suffix="%" onChange={(floorWaste) => onPatch({ floorWaste })} />
            </PriceGroup>
            <PriceGroup title={t("wall")} muted={!wallVisible}>
              <NumberField id={`${room.id}-wall-price`} label={t("pricePerSquareMeter")} value={room.wallPrice} suffix="₫" step={1000} disabled={!wallVisible} onChange={(wallPrice) => onPatch({ wallPrice })} />
              <NumberField id={`${room.id}-wall-waste`} label={t("waste")} value={room.wallWaste} suffix="%" disabled={!wallVisible} onChange={(wallWaste) => onPatch({ wallWaste })} />
            </PriceGroup>
            <PriceGroup title={t("skirting")} muted={!room.skirtEnabled}>
              <div className="grid grid-cols-2 gap-2">
                <NumberField id={`${room.id}-skirt-height`} label={t("skirtHeight")} value={room.skirtHeight} suffix="cm" disabled={!room.skirtEnabled} onChange={(skirtHeight) => onPatch({ skirtHeight })} />
                <SelectField
                  id={`${room.id}-skirt-price-mode`}
                  label={t("priceMode")}
                  value={room.skirtPriceMode}
                  disabled={!room.skirtEnabled}
                  options={[
                    { value: "m", label: t("perLinearMeter") },
                    { value: "m2", label: t("perSquareMeter") },
                  ]}
                  onChange={(skirtPriceMode) => onPatch({ skirtPriceMode: skirtPriceMode as TileRoom["skirtPriceMode"] })}
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <NumberField id={`${room.id}-skirt-price`} label={t("price")} value={room.skirtPrice} suffix="₫" step={1000} disabled={!room.skirtEnabled} onChange={(skirtPrice) => onPatch({ skirtPrice })} />
                <NumberField id={`${room.id}-skirt-waste`} label={t("waste")} value={room.skirtWaste} suffix="%" disabled={!room.skirtEnabled} onChange={(skirtWaste) => onPatch({ skirtWaste })} />
              </div>
            </PriceGroup>
          </div>
        </CalculatorSection>

        {room.wallMultiType && (
          <CalculatorSection icon={<Palette />} title={t("wallTypes")} description={t("wallTypesHint")} tinted>
            <div className="space-y-2">
              {room.wallTypes.map((type, typeIndex) => {
                const result = calculation.wall.typeResults[typeIndex];
                return (
                  <div key={type.id} className="grid gap-2 rounded-xl border border-border-soft bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(10rem,1fr)_2rem] sm:items-end">
                    <TextField label={t("typeName")} value={type.name} onChange={(name) => onPatchWallType(type.id, { name })} />
                    <NumberField id={`${room.id}-${type.id}-rows`} label={t("rows")} value={type.rows} onChange={(rows) => onPatchWallType(type.id, { rows })} />
                    <p className="self-center text-xs leading-5 text-slate-500 dark:text-slate-400 sm:pb-1">
                      {result && result.rows > 0
                        ? t("wallTypeResult", { perRow: result.tilesPerRow, rows: result.rows, tiles: result.tileCount, area: number.format(result.tileArea) })
                        : t("enterRows")}
                    </p>
                    <Button type="button" variant="ghost" size="iconSm" onClick={() => onRemoveWallType(type.id)} aria-label={t("removeWallType", { name: type.name })} className="text-slate-400 hover:text-er">
                      <Trash2 />
                    </Button>
                  </div>
                );
              })}
            </div>
            <Button type="button" variant="ghost" size="sm" onClick={onAddWallType} className="mt-2">
              <Plus /> {t("addWallType")}
            </Button>
          </CalculatorSection>
        )}

        <CalculatorSection icon={<DoorOpen />} title={t("openings")} description={t("openingsHint")}>
          {room.openings.length > 0 ? (
            <div className="space-y-2">
              {room.openings.map((opening) => (
                <div key={opening.id} className="grid gap-2 rounded-xl bg-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_7rem_7rem_2rem] sm:items-end">
                  <TextField label={t("openingName")} value={opening.name} onChange={(name) => onPatchOpening(opening.id, { name })} />
                  <NumberField id={`${room.id}-${opening.id}-width`} label={t("width")} value={opening.width} suffix="m" onChange={(width) => onPatchOpening(opening.id, { width })} />
                  <NumberField id={`${room.id}-${opening.id}-height`} label={t("height")} value={opening.height} suffix="m" onChange={(height) => onPatchOpening(opening.id, { height })} />
                  <Button type="button" variant="ghost" size="iconSm" onClick={() => onRemoveOpening(opening.id)} aria-label={t("removeOpening", { name: opening.name })} className="text-slate-400 hover:text-er">
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="rounded-xl bg-surface-2 px-4 py-3 text-sm text-slate-500 dark:text-slate-400">{t("noOpenings")}</p>
          )}
          <Button type="button" variant="ghost" size="sm" onClick={onAddOpening} className="mt-2">
            <Plus /> {t("addOpening")}
          </Button>
        </CalculatorSection>

        <RoomResult calculation={calculation} number={number} currency={currency} />
      </div>
    </article>
  );
}

function ProjectSummary({ rooms, calculations, totals, number, currency }: {
  rooms: TileRoom[];
  calculations: RoomCalculation[];
  totals: ReturnType<typeof calculateTotals>;
  number: Intl.NumberFormat;
  currency: Intl.NumberFormat;
}) {
  const t = useTranslations("tileCalculator");
  return (
    <aside className="overflow-hidden rounded-card border border-border bg-surface shadow-e1 xl:sticky xl:top-[4.625rem]">
      <div className="border-b border-border-soft bg-primary-50/70 px-5 py-4 dark:bg-primary-950/25">
        <p className="text-xs font-semibold tracking-[0.12em] text-primary-700 uppercase dark:text-primary-300">{t("projectSummary")}</p>
        <p className="mt-2 font-mono text-3xl font-bold tracking-tight text-slate-950 dark:text-white">{currency.format(totals.totalCost)}</p>
        <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("estimatedTotal")}</p>
      </div>

      <dl className="divide-y divide-border-soft px-5">
        <SummaryLine label={t("floorRequired")} value={`${number.format(totals.floorArea)} m²`} detail={t("tileCount", { count: totals.floorTiles })} />
        <SummaryLine label={t("wallRequired")} value={`${number.format(totals.wallArea)} m²`} detail={t("tileCount", { count: totals.wallTiles })} />
        <SummaryLine label={t("skirtRequired")} value={`${number.format(totals.skirtLength)} m`} detail={t("sourceTileCount", { count: totals.skirtSourceTiles })} />
      </dl>

      <div className="border-t border-border-soft px-5 py-4">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("byRoom")}</h2>
        <div className="mt-3 space-y-3">
          {rooms.map((room, index) => (
            <div key={room.id} className="flex items-start justify-between gap-3 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-700 dark:text-slate-200">{room.name}</p>
                <p className="mt-0.5 text-xs text-slate-400">{number.format(calculations[index].floor.area)} m² {t("floorAreaShort")}</p>
              </div>
              <span className="shrink-0 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{currency.format(calculations[index].totalCost)}</span>
            </div>
          ))}
        </div>
      </div>
    </aside>
  );
}

function RoomResult({ calculation, number, currency }: { calculation: RoomCalculation; number: Intl.NumberFormat; currency: Intl.NumberFormat }) {
  const t = useTranslations("tileCalculator");
  return (
    <section aria-label={t("roomResult")} className="overflow-hidden rounded-xl border border-primary-200 bg-primary-50/50 dark:border-primary-900 dark:bg-primary-950/20">
      <div className="grid gap-px bg-primary-200/60 sm:grid-cols-3 dark:bg-primary-900/60">
        <ResultMetric
          label={t("floor")}
          value={`${number.format(calculation.floor.requiredArea)} m²`}
          detail={`${t("tileCount", { count: calculation.floor.tileCount })} · ${currency.format(calculation.floor.cost)}`}
        />
        <ResultMetric
          label={t("wall")}
          value={calculation.wall.enabled ? `${number.format(calculation.wall.requiredArea)} m²` : "—"}
          detail={calculation.wall.enabled ? `${t("tileCount", { count: calculation.wall.tileCount })} · ${currency.format(calculation.wall.cost)}` : t("notCalculated")}
        />
        <ResultMetric
          label={t("skirting")}
          value={calculation.skirt.enabled ? `${number.format(calculation.skirt.requiredLength)} m` : "—"}
          detail={calculation.skirt.enabled ? `${t("sourceTileCount", { count: calculation.skirt.sourceTileCount })} · ${currency.format(calculation.skirt.cost)}` : t("notCalculated")}
        />
      </div>
    </section>
  );
}

function CalculatorSection({ icon, title, description, tinted, children }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  tinted?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className={cn(tinted && "rounded-xl bg-primary-50/50 p-4 dark:bg-primary-950/15")}>
      <div className="mb-3 flex items-start gap-2.5">
        <span className="mt-0.5 text-primary-600 [&_svg]:size-4">{icon}</span>
        <div>
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
        </div>
      </div>
      {children}
    </section>
  );
}

function PriceGroup({ title, muted, children }: { title: string; muted?: boolean; children: React.ReactNode }) {
  return (
    <fieldset disabled={muted} className={cn("space-y-2 rounded-xl bg-surface-2 p-3 transition-opacity", muted && "opacity-45")}>
      <legend className="px-1 text-xs font-semibold text-slate-600 dark:text-slate-300">{title}</legend>
      {children}
    </fieldset>
  );
}

function NumberField({ id, label, hint, value, suffix, step = "any", disabled, onChange }: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  suffix?: string;
  step?: number | "any";
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  return (
    <label htmlFor={id} className="block min-w-0 space-y-1.5">
      <span className="flex min-w-0 items-baseline justify-between gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
        <span>{label}</span>
        {hint && <span className="font-normal text-slate-400">{hint}</span>}
      </span>
      <span className="relative block">
        <Input
          id={id}
          type="number"
          inputMode="decimal"
          min={0}
          step={step}
          disabled={disabled}
          value={value === 0 ? "" : value}
          onChange={(event) => onChange(toNumber(event.target.value))}
          className={cn("no-spinner tabular-nums", suffix && "pr-11")}
        />
        {suffix && <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs font-medium text-slate-400">{suffix}</span>}
      </span>
    </label>
  );
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block min-w-0 space-y-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <Input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function TileSelect({ id, label, sizes, value, onChange }: {
  id: string;
  label: string;
  sizes: readonly string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <SelectField
      id={id}
      label={label}
      value={value}
      options={sizes.map((size) => ({ value: size, label: tileSizeLabel(size) }))}
      onChange={onChange}
    />
  );
}

function SelectField({ id, label, value, options, disabled, onChange }: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label htmlFor={id} className="block min-w-0 space-y-1.5">
      <span className="text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>
      <span className="block [&>div]:w-full">
        <Select id={id} value={value} options={options} disabled={disabled} onValueChange={onChange} className="w-full" />
      </span>
    </label>
  );
}

function ToggleRow({ label, description, checked, onChange }: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-xl bg-surface-2 px-3.5 py-3">
      <div>
        <p className="text-sm font-medium text-slate-800 dark:text-slate-100">{label}</p>
        <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
      </div>
      <Toggle checked={checked} onChange={onChange} aria-label={label} />
    </div>
  );
}

function ResultMetric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="bg-surface px-4 py-3.5 dark:bg-surface">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 font-mono text-lg font-bold text-slate-900 dark:text-slate-100">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-400">{detail}</p>
    </div>
  );
}

function SummaryLine({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-4">
      <dt>
        <p className="text-sm font-medium text-slate-700 dark:text-slate-200">{label}</p>
        <p className="mt-0.5 text-xs text-slate-400">{detail}</p>
      </dt>
      <dd className="shrink-0 font-mono text-sm font-bold text-slate-900 dark:text-slate-100">{value}</dd>
    </div>
  );
}

function createRoom(id: string, name: string): TileRoom {
  return {
    id,
    name,
    length: 0,
    width: 0,
    height: 0,
    floorTileSize: "0.6x0.6",
    wallTileSize: "0.3x0.6",
    wallOrientation: "horizontal",
    skirtSourceTile: "0.6x0.6",
    floorPrice: 0,
    floorWaste: DEFAULT_WASTE,
    wallPrice: 0,
    wallWaste: DEFAULT_WASTE,
    skirtPrice: 0,
    skirtWaste: DEFAULT_WASTE,
    skirtPriceMode: "m",
    skirtHeight: DEFAULT_SKIRT_HEIGHT,
    skirtEnabled: true,
    wallMultiType: false,
    openings: [],
    wallTypes: [],
  };
}

function createInitialRooms(t: Translator): TileRoom[] {
  const living = {
    ...createRoom("room-living", t("livingRoom")),
    length: 5,
    width: 4,
    openings: [{ id: "opening-main", name: t("mainDoor"), width: 0.9, height: 2.1 }],
    wallTypes: defaultWallTypes(t, "living"),
  };
  const bathroom = {
    ...createRoom("room-bathroom", t("bathroom")),
    length: 2.5,
    width: 2,
    height: 2.4,
    floorTileSize: "0.3x0.3",
    skirtEnabled: false,
    wallMultiType: true,
    openings: [{ id: "opening-bathroom", name: t("door"), width: 0.7, height: 2 }],
    wallTypes: [
      { id: "bathroom-dark", name: t("darkTile"), rows: 2 },
      { id: "bathroom-accent", name: t("accentTile"), rows: 1 },
      { id: "bathroom-light", name: t("lightTile"), rows: 5 },
    ],
  };
  return [living, bathroom];
}

function defaultWallTypes(t: Translator, prefix: string): WallType[] {
  return [
    { id: `${prefix}-dark`, name: t("darkTile"), rows: 0 },
    { id: `${prefix}-accent`, name: t("accentTile"), rows: 0 },
    { id: `${prefix}-light`, name: t("lightTile"), rows: 0 },
  ];
}

function buildSummaryText(
  rooms: TileRoom[],
  calculations: RoomCalculation[],
  t: Translator,
  number: Intl.NumberFormat,
  currency: Intl.NumberFormat,
) {
  const lines = [t("copyTitle"), "═".repeat(42)];
  rooms.forEach((room, index) => {
    const calculation = calculations[index];
    lines.push("", room.name);
    lines.push(`  ${t("floor")}: ${number.format(calculation.floor.requiredArea)} m² · ${t("tileCount", { count: calculation.floor.tileCount })}`);
    if (calculation.wall.enabled) {
      lines.push(`  ${t("wall")}: ${number.format(calculation.wall.requiredArea)} m² · ${t("tileCount", { count: calculation.wall.tileCount })}`);
    }
    if (calculation.skirt.enabled) {
      lines.push(`  ${t("skirting")}: ${number.format(calculation.skirt.requiredLength)} m · ${t("sourceTileCount", { count: calculation.skirt.sourceTileCount })}`);
    }
    lines.push(`  ${t("estimatedCost")}: ${currency.format(calculation.totalCost)}`);
  });
  return lines.join("\n");
}

async function writeClipboard(text: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  if (!copied) throw new Error("Clipboard unavailable");
}

function makeId(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function toNumber(value: string) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}
