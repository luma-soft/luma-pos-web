"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  Check,
  ChevronDown,
  CircleAlert,
  Copy,
  DoorOpen,
  Layers3,
  Minus,
  Palette,
  Plus,
  ReceiptText,
  Ruler,
  Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";
import {
  DEFAULT_SKIRT_HEIGHT,
  DEFAULT_WASTE,
  FLOOR_TILE_SIZES,
  SKIRT_TILE_SIZES,
  WALL_TILE_SIZES,
  calculateMaterialGroups,
  calculateRoom,
  calculateTotals,
  materialSourceRoomId,
  resolveRoomMaterials,
  tileSizeLabel,
  type MaterialGroup,
  type MaterialKind,
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
  const [activeRoomId, setActiveRoomId] = useState("room-living");
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const effectiveRooms = useMemo(() => resolveRoomMaterials(rooms), [rooms]);
  const calculations = useMemo(() => effectiveRooms.map(calculateRoom), [effectiveRooms]);
  const materialGroups = useMemo(
    () => calculateMaterialGroups(rooms, effectiveRooms, calculations),
    [rooms, effectiveRooms, calculations],
  );
  const totals = useMemo(() => calculateTotals(calculations, materialGroups), [calculations, materialGroups]);
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
    const nextRoom = createRoom(makeId("room"), t("roomDefaultName", { number: roomNumber }));
    setRooms((current) => [
      ...current,
      nextRoom,
    ]);
    setActiveRoomId(nextRoom.id);
  }

  function removeRoom(roomId: string) {
    setRooms((current) => {
      if (current.length <= 1) return current;
      const effective = resolveRoomMaterials(current);
      const next = current
        .filter((room) => room.id !== roomId)
        .map((room) => {
          let patched = room;
          for (const kind of ["floor", "wall", "skirt"] as const) {
            if (materialSourceRoomId(current, room.id, kind) !== roomId) continue;
            const effectiveRoom = effective.find((candidate) => candidate.id === room.id) ?? room;
            patched = { ...patched, ...materialPatch(effectiveRoom, kind), [materialSourceField(kind)]: "" };
          }
          return patched;
        });
      if (activeRoomId === roomId) setActiveRoomId(next[0].id);
      return next;
    });
  }

  function patchMaterialSource(roomId: string, kind: MaterialKind, sourceId: string) {
    setRooms((current) => {
      const effective = resolveRoomMaterials(current);
      return current.map((room) => {
        if (room.id !== roomId) return room;
        const ownMaterial = sourceId === ""
          ? materialPatch(effective.find((candidate) => candidate.id === roomId) ?? room, kind)
          : {};
        return { ...room, ...ownMaterial, [materialSourceField(kind)]: sourceId };
      });
    });
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
          quantity: 1,
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
    const text = buildSummaryText(rooms, calculations, materialGroups, t, number, currency);
    try {
      await writeClipboard(text);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 1800);
    } catch {
      setCopyState("error");
    }
  }

  const activeIndex = Math.max(0, rooms.findIndex((room) => room.id === activeRoomId));
  const activeRoom = rooms[activeIndex];
  const activeEffectiveRoom = effectiveRooms[activeIndex];

  return (
    <div className="min-h-full bg-canvas [&_button]:min-h-11 [&_button]:min-w-11 lg:[&_button]:min-h-0 lg:[&_button]:min-w-0">
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

        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_20rem] 2xl:grid-cols-[13rem_minmax(28rem,1fr)_20rem]">
          <RoomNavigator
            rooms={rooms}
            activeRoomId={activeRoom.id}
            calculations={calculations}
            number={number}
            onSelect={setActiveRoomId}
            onAdd={addRoom}
          />

          <section aria-label={t("rooms")} className="min-w-0 space-y-4">
            {activeRoom && (
              <RoomCard
                key={activeRoom.id}
                room={activeRoom}
                effectiveRoom={activeEffectiveRoom}
                rooms={rooms}
                calculation={calculations[activeIndex]}
                index={activeIndex}
                number={number}
                currency={currency}
                canRemove={rooms.length > 1}
                onPatch={(patch) => patchRoom(activeRoom.id, patch)}
                onPatchMaterialSource={(kind, sourceId) => patchMaterialSource(activeRoom.id, kind, sourceId)}
                onRemove={() => removeRoom(activeRoom.id)}
                onAddOpening={() => addOpening(activeRoom.id)}
                onPatchOpening={(openingId, patch) => patchOpening(activeRoom.id, openingId, patch)}
                onRemoveOpening={(openingId) => removeOpening(activeRoom.id, openingId)}
                onAddWallType={() => addWallType(activeRoom.id)}
                onPatchWallType={(typeId, patch) => patchWallType(activeRoom.id, typeId, patch)}
                onRemoveWallType={(typeId) => removeWallType(activeRoom.id, typeId)}
              />
            )}
          </section>

          <ProjectSummary
            rooms={rooms}
            calculations={calculations}
            totals={totals}
            materialGroups={materialGroups}
            number={number}
            currency={currency}
          />
        </div>
      </main>
    </div>
  );
}

function RoomNavigator({ rooms, activeRoomId, calculations, number, onSelect, onAdd }: {
  rooms: TileRoom[];
  activeRoomId: string;
  calculations: RoomCalculation[];
  number: Intl.NumberFormat;
  onSelect: (roomId: string) => void;
  onAdd: () => void;
}) {
  const t = useTranslations("tileCalculator");
  const activeRoomRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    activeRoomRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [activeRoomId]);

  return (
    <nav aria-label={t("rooms")} className="rounded-card border border-border bg-surface p-3 shadow-e1 xl:col-span-2 2xl:col-span-1 2xl:sticky 2xl:top-[4.625rem]">
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-xs font-semibold text-slate-500">{t("roomGroups", { count: rooms.length })}</p>
        <Button type="button" variant="ghost" size="sm" onClick={onAdd}><Plus /> {t("addRoomShort")}</Button>
      </div>
      <div className="flex snap-x snap-mandatory gap-2 overflow-x-auto overscroll-x-contain pb-1 2xl:flex-col 2xl:overflow-visible 2xl:pb-0">
        {rooms.map((room, index) => (
          <button
            key={room.id}
            ref={room.id === activeRoomId ? activeRoomRef : undefined}
            type="button"
            onClick={() => onSelect(room.id)}
            aria-current={room.id === activeRoomId ? "page" : undefined}
            className={cn(
              "flex min-h-[4.5rem] w-[15rem] shrink-0 snap-start items-center gap-3 rounded-xl border px-3 py-3 text-left transition 2xl:w-full",
              room.id === activeRoomId
                ? "border-primary-300 bg-primary-50 text-primary-900 dark:border-primary-800 dark:bg-primary-950/30 dark:text-primary-100"
                : "border-transparent bg-surface-2 hover:border-border hover:bg-surface",
            )}
          >
            <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface font-mono text-xs font-bold text-primary-700 shadow-e1 dark:text-primary-300">
              {String(index + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">{room.name}</span>
              <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-slate-500 2xl:block">
                <span className="block truncate">{t("identicalRooms", { count: room.quantity })}</span>
                <span aria-hidden className="shrink-0 2xl:hidden">·</span>
                <span className="shrink-0 2xl:mt-0.5 2xl:block">{number.format(calculations[index].floor.area)} m²</span>
              </span>
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}

function RoomCard({
  room,
  effectiveRoom,
  rooms,
  calculation,
  index,
  number,
  currency,
  canRemove,
  onPatch,
  onPatchMaterialSource,
  onRemove,
  onAddOpening,
  onPatchOpening,
  onRemoveOpening,
  onAddWallType,
  onPatchWallType,
  onRemoveWallType,
}: {
  room: TileRoom;
  effectiveRoom: TileRoom;
  rooms: TileRoom[];
  calculation: RoomCalculation;
  index: number;
  number: Intl.NumberFormat;
  currency: Intl.NumberFormat;
  canRemove: boolean;
  onPatch: (patch: Partial<TileRoom>) => void;
  onPatchMaterialSource: (kind: MaterialKind, sourceId: string) => void;
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
  const floorLinked = room.floorMaterialSourceId !== "";
  const wallLinked = room.wallMaterialSourceId !== "";
  const skirtLinked = room.skirtMaterialSourceId !== "";

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
            className="h-11 lg:h-9 border-transparent bg-transparent px-2 text-base font-semibold hover:border-border hover:bg-surface focus:bg-surface"
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
        <section className="rounded-xl border border-primary-200 bg-primary-50/45 p-4 dark:border-primary-900 dark:bg-primary-950/20">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("roomQuantity")}</p>
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{t("roomQuantityHint")}</p>
            </div>
            <QuantityStepper value={room.quantity} label={t("roomQuantity")} onChange={(quantity) => onPatch({ quantity })} />
          </div>
        </section>

        <CalculatorSection icon={<Ruler />} title={t("dimensions")} description={t("dimensionsHint")} defaultOpen>
          <div className="grid gap-3 sm:grid-cols-3">
            <NumberField id={`${room.id}-length`} label={t("length")} value={room.length} suffix="m" onChange={(length) => onPatch({ length })} />
            <NumberField id={`${room.id}-width`} label={t("width")} value={room.width} suffix="m" onChange={(width) => onPatch({ width })} />
            <NumberField id={`${room.id}-height`} label={t("height")} hint={t("optional")} value={room.height} suffix="m" onChange={(height) => onPatch({ height })} />
          </div>
          <div className="mt-4 rounded-xl border border-primary-200 bg-primary-50 px-4 py-3 dark:border-primary-900 dark:bg-primary-950/25">
            <p className="text-xs font-semibold text-primary-700 dark:text-primary-300">{t("floorAreaFormula")}</p>
            <p className="mt-1 font-mono text-xl font-bold text-slate-950 dark:text-white">
              {number.format(room.length)} × {number.format(room.width)} × {room.quantity} = {number.format(calculation.floor.area)} m²
            </p>
          </div>
        </CalculatorSection>

        <CalculatorSection icon={<Layers3 />} title={t("materials")} description={t("materialsHint")}>
          <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
            <div className="space-y-3 rounded-xl bg-surface-2 p-3">
              <MaterialSourceField room={room} rooms={rooms} kind="floor" onChange={(sourceId) => onPatchMaterialSource("floor", sourceId)} />
              <TileSelect
                id={`${room.id}-floor-tile`}
                label={t("floorTile")}
                sizes={FLOOR_TILE_SIZES}
                value={effectiveRoom.floorTileSize}
                disabled={floorLinked}
                onChange={(floorTileSize) => onPatch({ floorTileSize })}
              />
            </div>
            {wallVisible && (
              <div className="space-y-3 rounded-xl bg-surface-2 p-3">
                <MaterialSourceField room={room} rooms={rooms} kind="wall" onChange={(sourceId) => onPatchMaterialSource("wall", sourceId)} />
                <div className="grid grid-cols-[minmax(0,1fr)_8.5rem] gap-2">
                  <TileSelect
                    id={`${room.id}-wall-tile`}
                    label={t("wallTile")}
                    sizes={WALL_TILE_SIZES}
                    value={effectiveRoom.wallTileSize}
                    disabled={wallLinked}
                    onChange={(wallTileSize) => onPatch({ wallTileSize })}
                  />
                  <SelectField
                    id={`${room.id}-orientation`}
                    label={t("orientation")}
                    value={effectiveRoom.wallOrientation}
                    disabled={wallLinked}
                    options={[
                      { value: "horizontal", label: t("horizontal") },
                      { value: "vertical", label: t("vertical") },
                    ]}
                    onChange={(wallOrientation) => onPatch({ wallOrientation: wallOrientation as TileRoom["wallOrientation"] })}
                  />
                </div>
              </div>
            )}
            {room.skirtEnabled && (
              <div className="space-y-3 rounded-xl bg-surface-2 p-3">
                <MaterialSourceField room={room} rooms={rooms} kind="skirt" onChange={(sourceId) => onPatchMaterialSource("skirt", sourceId)} />
                <TileSelect
                  id={`${room.id}-skirt-tile`}
                  label={t("skirtSourceTile")}
                  sizes={SKIRT_TILE_SIZES}
                  value={effectiveRoom.skirtSourceTile}
                  disabled={skirtLinked}
                  onChange={(skirtSourceTile) => onPatch({ skirtSourceTile })}
                />
              </div>
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

        {room.wallMultiType && (
          <CalculatorSection icon={<Palette />} title={t("wallTypes")} description={t("wallTypesHint")} tinted>
            <div className="space-y-2">
              {room.wallTypes.map((type, typeIndex) => {
                const result = calculation.wall.typeResults[typeIndex];
                return (
                  <div key={type.id} className="grid gap-2 rounded-xl border border-border-soft bg-surface p-3 sm:grid-cols-[minmax(0,1fr)_7rem_minmax(10rem,1fr)_44px] sm:items-end lg:grid-cols-[minmax(0,1fr)_7rem_minmax(10rem,1fr)_2rem]">
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
                <div key={opening.id} className="grid gap-2 rounded-xl bg-surface-2 p-3 sm:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_8.5rem_44px] sm:items-end lg:grid-cols-[minmax(0,1fr)_6.5rem_6.5rem_8.5rem_2rem]">
                  <TextField label={t("openingName")} value={opening.name} onChange={(name) => onPatchOpening(opening.id, { name })} />
                  <NumberField id={`${room.id}-${opening.id}-width`} label={t("width")} value={opening.width} suffix="m" onChange={(width) => onPatchOpening(opening.id, { width })} />
                  <NumberField id={`${room.id}-${opening.id}-height`} label={t("height")} value={opening.height} suffix="m" onChange={(height) => onPatchOpening(opening.id, { height })} />
                  <QuantityStepper compact value={opening.quantity} label={t("quantity")} onChange={(quantity) => onPatchOpening(opening.id, { quantity })} />
                  <Button type="button" variant="ghost" size="iconSm" onClick={() => onRemoveOpening(opening.id)} aria-label={t("removeOpening", { name: opening.name })} className="text-slate-400 hover:text-er">
                    <Trash2 />
                  </Button>
                  <p className="text-xs text-slate-500 sm:col-span-5 lg:col-span-5">
                    {number.format(opening.width)} × {number.format(opening.height)} × {opening.quantity} = {number.format(opening.width * opening.height * opening.quantity)} m² / {t("roomUnit")}
                  </p>
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

        <CalculatorSection icon={<ReceiptText />} title={t("pricing")} description={t("pricingHint")}>
          <div className="grid gap-4 xl:grid-cols-2">
            <PriceGroup title={t("floor")}>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField id={`${room.id}-floor-price`} label={t("pricePerSquareMeter")} value={effectiveRoom.floorPrice} suffix="₫" money step={1000} disabled={floorLinked} onChange={(floorPrice) => onPatch({ floorPrice })} />
                <NumberField id={`${room.id}-floor-waste`} label={t("waste")} value={effectiveRoom.floorWaste} suffix="%" disabled={floorLinked} onChange={(floorWaste) => onPatch({ floorWaste })} />
              </div>
            </PriceGroup>
            <PriceGroup title={t("wall")} muted={!wallVisible}>
              <div className="grid gap-3 sm:grid-cols-2">
                <NumberField id={`${room.id}-wall-price`} label={t("pricePerSquareMeter")} value={effectiveRoom.wallPrice} suffix="₫" money step={1000} disabled={!wallVisible || wallLinked} onChange={(wallPrice) => onPatch({ wallPrice })} />
                <NumberField id={`${room.id}-wall-waste`} label={t("waste")} value={effectiveRoom.wallWaste} suffix="%" disabled={!wallVisible || wallLinked} onChange={(wallWaste) => onPatch({ wallWaste })} />
              </div>
            </PriceGroup>
            <PriceGroup title={t("skirting")} muted={!room.skirtEnabled} className="xl:col-span-2">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <NumberField id={`${room.id}-skirt-height`} label={t("skirtHeight")} value={effectiveRoom.skirtHeight} suffix="cm" disabled={!room.skirtEnabled || skirtLinked} onChange={(skirtHeight) => onPatch({ skirtHeight })} />
                <SelectField
                  id={`${room.id}-skirt-price-mode`}
                  label={t("priceMode")}
                  value={effectiveRoom.skirtPriceMode}
                  disabled={!room.skirtEnabled || skirtLinked}
                  options={[
                    { value: "m", label: t("perLinearMeter") },
                    { value: "m2", label: t("perSquareMeter") },
                  ]}
                  onChange={(skirtPriceMode) => onPatch({ skirtPriceMode: skirtPriceMode as TileRoom["skirtPriceMode"] })}
                />
                <NumberField id={`${room.id}-skirt-price`} label={t("price")} value={effectiveRoom.skirtPrice} suffix="₫" money step={1000} disabled={!room.skirtEnabled || skirtLinked} onChange={(skirtPrice) => onPatch({ skirtPrice })} />
                <NumberField id={`${room.id}-skirt-waste`} label={t("waste")} value={effectiveRoom.skirtWaste} suffix="%" disabled={!room.skirtEnabled || skirtLinked} onChange={(skirtWaste) => onPatch({ skirtWaste })} />
              </div>
            </PriceGroup>
          </div>
        </CalculatorSection>

        <RoomResult calculation={calculation} number={number} currency={currency} />
      </div>
    </article>
  );
}

function ProjectSummary({ rooms, calculations, totals, materialGroups, number, currency }: {
  rooms: TileRoom[];
  calculations: RoomCalculation[];
  totals: ReturnType<typeof calculateTotals>;
  materialGroups: MaterialGroup[];
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
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{t("materialsSummary")}</h2>
          <span className="rounded-full bg-primary-50 px-2 py-0.5 text-[11px] font-semibold text-primary-700 dark:bg-primary-950/40 dark:text-primary-300">
            {t("materialGroupCount", { count: materialGroups.length })}
          </span>
        </div>
        <div className="mt-3 max-h-80 space-y-2 overflow-y-auto pr-1">
          {materialGroups.map((group) => {
            const names = group.roomIds
              .map((roomId) => rooms.find((room) => room.id === roomId)?.name)
              .filter(Boolean)
              .join(", ");
            const kindLabel = group.kind === "floor" ? t("floor") : group.kind === "wall" ? t("wall") : t("skirting");
            const amount = group.kind === "skirt"
              ? `${number.format(group.requiredLength)} m · ${t("sourceTileCount", { count: group.tileCount })}`
              : `${number.format(group.requiredArea)} m² · ${t("tileCount", { count: group.tileCount })}`;
            return (
              <div key={group.id} className="rounded-xl bg-surface-2 p-3">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-xs font-semibold text-slate-800 dark:text-slate-100">{kindLabel} · {tileSizeLabel(group.tileSize)}</p>
                  <span className="shrink-0 font-mono text-xs font-semibold text-slate-700 dark:text-slate-200">{currency.format(group.cost)}</span>
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-500" title={names}>{names}</p>
                <p className="mt-1 font-mono text-xs font-semibold text-primary-700 dark:text-primary-300">{amount}</p>
              </div>
            );
          })}
        </div>
      </div>

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

function CalculatorSection({ icon, title, description, tinted, defaultOpen, children }: {
  icon: React.ReactNode;
  title: string;
  description: string;
  tinted?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  return (
    <details open={defaultOpen ? true : undefined} className={cn("group rounded-xl border border-border-soft bg-surface", tinted && "bg-primary-50/50 dark:bg-primary-950/15")}>
      <summary className="flex cursor-pointer list-none items-start gap-2.5 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 text-primary-600 [&_svg]:size-4">{icon}</span>
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
          <p className="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">{description}</p>
        </div>
        <ChevronDown aria-hidden className="size-4 text-slate-400 transition group-open:rotate-180" />
      </summary>
      <div className="border-t border-border-soft px-4 py-4">{children}</div>
    </details>
  );
}

function QuantityStepper({ value, label, compact = false, onChange }: {
  value: number;
  label: string;
  compact?: boolean;
  onChange: (value: number) => void;
}) {
  const t = useTranslations("tileCalculator");
  const normalized = Math.min(999, Math.max(1, Math.floor(value || 1)));
  return (
    <div className={cn("space-y-1.5", compact && "min-w-0")}>
      {compact && <span className="block text-xs font-medium text-slate-600 dark:text-slate-300">{label}</span>}
      <div className="grid grid-cols-[2.75rem_minmax(3rem,1fr)_2.75rem] overflow-hidden rounded-lg border border-border bg-surface">
        <button type="button" disabled={normalized <= 1} onClick={() => onChange(normalized - 1)} aria-label={`${t("decreaseQuantity")} ${label}`} className="grid place-items-center border-r border-border text-slate-600 disabled:opacity-35"><Minus className="size-4" /></button>
        <input aria-label={label} inputMode="numeric" min={1} max={999} value={normalized} onChange={(event) => onChange(Math.min(999, Math.max(1, Number.parseInt(event.target.value, 10) || 1)))} className="h-10 min-w-0 bg-transparent text-center font-mono font-bold outline-none" />
        <button type="button" disabled={normalized >= 999} onClick={() => onChange(normalized + 1)} aria-label={`${t("increaseQuantity")} ${label}`} className="grid place-items-center border-l border-border text-slate-600 disabled:opacity-35"><Plus className="size-4" /></button>
      </div>
    </div>
  );
}

function PriceGroup({ title, muted, className, children }: { title: string; muted?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <fieldset disabled={muted} className={cn("rounded-xl bg-surface-2 p-4 transition-opacity", muted && "opacity-45", className)}>
      <legend className="sr-only">{title}</legend>
      <p aria-hidden className="mb-3 text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</p>
      <div className="min-w-0">{children}</div>
    </fieldset>
  );
}

function NumberField({ id, label, hint, value, suffix, money = false, step = "any", disabled, onChange }: {
  id: string;
  label: string;
  hint?: string;
  value: number;
  suffix?: string;
  money?: boolean;
  step?: number | "any";
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const FieldInput = money ? MoneyInput : NumberInput;
  return (
    <label htmlFor={id} className="block min-w-0 space-y-1.5">
      <span className="flex min-w-0 items-baseline justify-between gap-2 text-xs font-medium text-slate-600 dark:text-slate-300">
        <span>{label}</span>
        {hint && <span className="font-normal text-slate-400">{hint}</span>}
      </span>
      <span className="relative block">
        <FieldInput
          id={id}
          min={0}
          step={step}
          decimals={4}
          disabled={disabled}
          value={value}
          onChange={(nextValue) => onChange(nextValue ?? 0)}
          className="tabular-nums"
          suffix={suffix}
        />
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

function MaterialSourceField({ room, rooms, kind, onChange }: {
  room: TileRoom;
  rooms: TileRoom[];
  kind: MaterialKind;
  onChange: (sourceId: string) => void;
}) {
  const t = useTranslations("tileCalculator");
  const value = kind === "floor"
    ? room.floorMaterialSourceId
    : kind === "wall" ? room.wallMaterialSourceId : room.skirtMaterialSourceId;
  const options = [
    { value: "", label: t("ownMaterial") },
    ...rooms
      .filter((candidate) => candidate.id !== room.id && materialSourceRoomId(rooms, candidate.id, kind) !== room.id)
      .map((candidate) => ({ value: candidate.id, label: t("useRoomMaterial", { room: candidate.name }) })),
  ];
  return (
    <SelectField
      id={`${room.id}-${kind}-material-source`}
      label={t("materialSource")}
      value={value}
      options={options}
      onChange={onChange}
    />
  );
}

function TileSelect({ id, label, sizes, value, disabled, onChange }: {
  id: string;
  label: string;
  sizes: readonly string[];
  value: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <SelectField
      id={id}
      label={label}
      value={value}
      options={sizes.map((size) => ({ value: size, label: tileSizeLabel(size) }))}
      disabled={disabled}
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
        <Select
          id={id}
          value={value}
          options={options}
          disabled={disabled}
          onValueChange={onChange}
          optionClassName="min-h-11 lg:min-h-0"
          className="w-full"
        />
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
    quantity: 1,
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
    floorMaterialSourceId: "",
    wallMaterialSourceId: "",
    skirtMaterialSourceId: "",
  };
}

function createInitialRooms(t: Translator): TileRoom[] {
  const living = {
    ...createRoom("room-living", t("livingRoom")),
    length: 5,
    width: 4,
    openings: [{ id: "opening-main", name: t("mainDoor"), width: 0.9, height: 2.1, quantity: 1 }],
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
    openings: [{ id: "opening-bathroom", name: t("door"), width: 0.7, height: 2, quantity: 1 }],
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
  materialGroups: MaterialGroup[],
  t: Translator,
  number: Intl.NumberFormat,
  currency: Intl.NumberFormat,
) {
  const lines = [t("copyTitle"), "═".repeat(42)];
  rooms.forEach((room, index) => {
    const calculation = calculations[index];
    lines.push("", `${room.name} × ${room.quantity} ${t("roomUnit")}`);
    lines.push(`  ${t("floor")}: ${number.format(calculation.floor.requiredArea)} m² · ${t("tileCount", { count: calculation.floor.tileCount })}`);
    if (calculation.wall.enabled) {
      lines.push(`  ${t("wall")}: ${number.format(calculation.wall.requiredArea)} m² · ${t("tileCount", { count: calculation.wall.tileCount })}`);
    }
    if (calculation.skirt.enabled) {
      lines.push(`  ${t("skirting")}: ${number.format(calculation.skirt.requiredLength)} m · ${t("sourceTileCount", { count: calculation.skirt.sourceTileCount })}`);
    }
    lines.push(`  ${t("estimatedCost")}: ${currency.format(calculation.totalCost)}`);
  });
  lines.push("", t("materialsSummary"));
  materialGroups.forEach((group) => {
    const names = group.roomIds
      .map((roomId) => rooms.find((room) => room.id === roomId)?.name)
      .filter(Boolean)
      .join(", ");
    const kind = group.kind === "floor" ? t("floor") : group.kind === "wall" ? t("wall") : t("skirting");
    const amount = group.kind === "skirt"
      ? `${number.format(group.requiredLength)} m · ${t("sourceTileCount", { count: group.tileCount })}`
      : `${number.format(group.requiredArea)} m² · ${t("tileCount", { count: group.tileCount })}`;
    lines.push(`  ${kind} · ${tileSizeLabel(group.tileSize)} · ${names}: ${amount} · ${currency.format(group.cost)}`);
  });
  return lines.join("\n");
}

function materialSourceField(kind: MaterialKind) {
  if (kind === "floor") return "floorMaterialSourceId";
  if (kind === "wall") return "wallMaterialSourceId";
  return "skirtMaterialSourceId";
}

function materialPatch(room: TileRoom, kind: MaterialKind): Partial<TileRoom> {
  if (kind === "floor") {
    return { floorTileSize: room.floorTileSize, floorPrice: room.floorPrice, floorWaste: room.floorWaste };
  }
  if (kind === "wall") {
    return {
      wallTileSize: room.wallTileSize,
      wallOrientation: room.wallOrientation,
      wallPrice: room.wallPrice,
      wallWaste: room.wallWaste,
    };
  }
  return {
    skirtSourceTile: room.skirtSourceTile,
    skirtPrice: room.skirtPrice,
    skirtWaste: room.skirtWaste,
    skirtPriceMode: room.skirtPriceMode,
    skirtHeight: room.skirtHeight,
  };
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
