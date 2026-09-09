export const DEFAULT_WASTE = 5;
export const DEFAULT_SKIRT_HEIGHT = 12;

export const FLOOR_TILE_SIZES = [
  "0.3x0.3",
  "0.4x0.4",
  "0.4x0.6",
  "0.42x0.6",
  "0.5x0.5",
  "0.6x0.6",
  "0.8x0.8",
  "0.6x1.2",
  "0.8x1.6",
] as const;

export const WALL_TILE_SIZES = [
  "0.2x0.25",
  "0.25x0.4",
  "0.3x0.45",
  "0.3x0.6",
  "0.4x0.6",
  "0.4x0.8",
  "0.6x0.6",
  "0.6x1.2",
] as const;

export const SKIRT_TILE_SIZES = FLOOR_TILE_SIZES;

export type WallOrientation = "horizontal" | "vertical";
export type SkirtPriceMode = "m" | "m2";
export type MaterialKind = "floor" | "wall" | "skirt";

export interface Opening {
  id: string;
  name: string;
  width: number;
  height: number;
  quantity: number;
}

export interface WallType {
  id: string;
  name: string;
  rows: number;
}

export interface TileRoom {
  id: string;
  name: string;
  quantity: number;
  length: number;
  width: number;
  height: number;
  floorTileSize: string;
  wallTileSize: string;
  wallOrientation: WallOrientation;
  skirtSourceTile: string;
  floorPrice: number;
  floorWaste: number;
  wallPrice: number;
  wallWaste: number;
  skirtPrice: number;
  skirtWaste: number;
  skirtPriceMode: SkirtPriceMode;
  skirtHeight: number;
  skirtEnabled: boolean;
  wallMultiType: boolean;
  openings: Opening[];
  wallTypes: WallType[];
  floorMaterialSourceId: string;
  wallMaterialSourceId: string;
  skirtMaterialSourceId: string;
}

export interface WallTypeResult extends WallType {
  tilesPerRow: number;
  tileCount: number;
  tileArea: number;
}

export interface RoomCalculation {
  perimeter: number;
  openingArea: number;
  openingWidth: number;
  floor: {
    area: number;
    requiredArea: number;
    tileCount: number;
    cost: number;
  };
  wall: {
    enabled: boolean;
    area: number;
    requiredArea: number;
    tileCount: number;
    cost: number;
    typeResults: WallTypeResult[];
  };
  skirt: {
    enabled: boolean;
    length: number;
    requiredLength: number;
    sourceTileCount: number;
    sourceArea: number;
    stripsPerTile: number;
    cost: number;
  };
  totalCost: number;
}

export interface CalculatorTotals {
  floorArea: number;
  floorTiles: number;
  wallArea: number;
  wallTiles: number;
  skirtLength: number;
  skirtSourceTiles: number;
  totalCost: number;
}

export interface MaterialGroup {
  id: string;
  kind: MaterialKind;
  sourceRoomId: string;
  roomIds: string[];
  tileSize: string;
  requiredArea: number;
  requiredLength: number;
  tileCount: number;
  cost: number;
}

const materialFields = {
  floor: ["floorTileSize", "floorPrice", "floorWaste"],
  wall: ["wallTileSize", "wallOrientation", "wallPrice", "wallWaste"],
  skirt: ["skirtSourceTile", "skirtPrice", "skirtWaste", "skirtPriceMode", "skirtHeight"],
} as const satisfies Record<MaterialKind, readonly (keyof TileRoom)[]>;

export function materialSourceRoomId(rooms: TileRoom[], roomId: string, kind: MaterialKind) {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  const original = byId.get(roomId);
  if (!original) return roomId;
  const seen = new Set([roomId]);
  let current = original;
  while (true) {
    const sourceId = sourceIdFor(current, kind);
    if (!sourceId || seen.has(sourceId)) return current === original ? roomId : current.id;
    const source = byId.get(sourceId);
    if (!source) return current.id;
    seen.add(sourceId);
    current = source;
  }
}

export function resolveRoomMaterials(rooms: TileRoom[]) {
  const byId = new Map(rooms.map((room) => [room.id, room]));
  return rooms.map((room) => {
    const resolved = { ...room };
    for (const kind of ["floor", "wall", "skirt"] as const) {
      const source = byId.get(materialSourceRoomId(rooms, room.id, kind));
      if (!source) continue;
      for (const field of materialFields[kind]) {
        Object.assign(resolved, { [field]: source[field] });
      }
    }
    return resolved;
  });
}

export function calculateMaterialGroups(
  rooms: TileRoom[],
  effectiveRooms: TileRoom[],
  calculations: RoomCalculation[],
): MaterialGroup[] {
  const groups = new Map<string, MaterialGroup & { hasMultiType?: boolean }>();
  const add = (kind: MaterialKind, index: number) => {
    const room = rooms[index];
    const effective = effectiveRooms[index];
    const calculation = calculations[index];
    if (kind === "wall" && !calculation.wall.enabled) return;
    if (kind === "skirt" && !calculation.skirt.enabled) return;
    const sourceRoomId = materialSourceRoomId(rooms, room.id, kind);
    const id = `${kind}:${sourceRoomId}`;
    const tileSize = kind === "floor"
      ? effective.floorTileSize
      : kind === "wall" ? effective.wallTileSize : effective.skirtSourceTile;
    const current = groups.get(id) ?? {
      id,
      kind,
      sourceRoomId,
      roomIds: [],
      tileSize,
      requiredArea: 0,
      requiredLength: 0,
      tileCount: 0,
      cost: 0,
    };
    current.roomIds.push(room.id);
    if (kind === "floor") {
      current.requiredArea += calculation.floor.requiredArea;
      current.cost += calculation.floor.cost;
    } else if (kind === "wall") {
      current.requiredArea += calculation.wall.requiredArea;
      current.tileCount += calculation.wall.tileCount;
      current.cost += calculation.wall.cost;
      current.hasMultiType ||= room.wallMultiType;
    } else {
      current.requiredLength += calculation.skirt.requiredLength;
    }
    groups.set(id, current);
  };

  rooms.forEach((_, index) => {
    add("floor", index);
    add("wall", index);
    add("skirt", index);
  });

  return [...groups.values()].map((group) => {
    const source = effectiveRooms[rooms.findIndex((room) => room.id === group.sourceRoomId)] ?? effectiveRooms[0];
    const tile = parseTileSize(group.tileSize);
    if (group.kind === "floor") {
      group.tileCount = tile.area > 0 ? Math.ceil(group.requiredArea / tile.area) : 0;
    } else if (group.kind === "wall" && !group.hasMultiType) {
      group.tileCount = tile.area > 0 ? Math.ceil(group.requiredArea / tile.area) : 0;
    } else if (group.kind === "skirt" && source) {
      const tileLong = Math.max(tile.a, tile.b);
      const tileShort = Math.min(tile.a, tile.b);
      const height = positive(source.skirtHeight) / 100;
      const strips = height > 0 ? Math.floor(tileShort / height) : 0;
      group.tileCount = strips > 0 && tileLong > 0
        ? Math.ceil(group.requiredLength / (strips * tileLong))
        : 0;
      group.cost = source.skirtPriceMode === "m2"
        ? group.tileCount * tile.area * positive(source.skirtPrice)
        : group.requiredLength * positive(source.skirtPrice);
    }
    return group;
  });
}

export function parseTileSize(value: string) {
  const [rawA, rawB] = value.split("x");
  const a = Number.parseFloat(rawA) || 0;
  const b = Number.parseFloat(rawB) || 0;
  return { a, b, area: a * b };
}

export function tileSizeLabel(value: string) {
  const { a, b } = parseTileSize(value);
  if (!a || !b) return "—";
  return `${Math.round(a * 100)} × ${Math.round(b * 100)} cm`;
}

export function calculateRoom(room: TileRoom): RoomCalculation {
  const quantity = wholeQuantity(room.quantity);
  const length = positive(room.length);
  const width = positive(room.width);
  const height = positive(room.height);
  const perimeter = 2 * (length + width);
  const floorArea = length * width * quantity;

  const openingArea = room.openings.reduce(
    (sum, opening) => sum + positive(opening.width) * positive(opening.height) * wholeQuantity(opening.quantity),
    0,
  );
  const openingWidth = room.openings.reduce(
    (sum, opening) => sum + positive(opening.width) * wholeQuantity(opening.quantity),
    0,
  );

  const wallTile = parseTileSize(room.wallTileSize);
  const horizontalSpan = room.wallOrientation === "horizontal"
    ? Math.max(wallTile.a, wallTile.b)
    : Math.min(wallTile.a, wallTile.b);
  const verticalSpan = room.wallOrientation === "horizontal"
    ? Math.min(wallTile.a, wallTile.b)
    : Math.max(wallTile.a, wallTile.b);
  const tilesPerRow = horizontalSpan > 0 ? Math.ceil(perimeter / horizontalSpan) : 0;
  const typeResults = room.wallTypes.map((type) => {
    const rows = positive(type.rows);
    const tileCount = tilesPerRow * rows * quantity;
    return {
      ...type,
      rows,
      tilesPerRow,
      tileCount,
      tileArea: tileCount * wallTile.area,
    };
  });

  const totalWallRows = typeResults.reduce((sum, type) => sum + type.rows, 0);
  const multiTypeTileCount = typeResults.reduce((sum, type) => sum + type.tileCount, 0);
  const wallEnabled = room.wallMultiType ? multiTypeTileCount > 0 : height > 0;
  const wallHeight = room.wallMultiType
    ? (height > 0 ? height : totalWallRows * verticalSpan)
    : height;
  const wallArea = wallEnabled ? Math.max(0, perimeter * wallHeight - openingArea) * quantity : 0;

  const skirtEnabled = room.skirtEnabled;
  const skirtLength = skirtEnabled ? Math.max(0, perimeter - openingWidth) * quantity : 0;

  const floorTile = parseTileSize(room.floorTileSize);
  const floorRequiredArea = floorArea * (1 + positive(room.floorWaste) / 100);
  const floorTileCount = floorTile.area > 0 ? Math.ceil(floorRequiredArea / floorTile.area) : 0;

  const wallRequiredArea = wallArea * (1 + positive(room.wallWaste) / 100);
  const wallTileCount = room.wallMultiType
    ? multiTypeTileCount
    : (wallTile.area > 0 ? Math.ceil(wallRequiredArea / wallTile.area) : 0);

  const skirtTile = parseTileSize(room.skirtSourceTile);
  const tileLong = Math.max(skirtTile.a, skirtTile.b);
  const tileShort = Math.min(skirtTile.a, skirtTile.b);
  const skirtHeightMeters = positive(room.skirtHeight) / 100;
  const stripsPerTile = skirtHeightMeters > 0 ? Math.floor(tileShort / skirtHeightMeters) : 0;
  const skirtRequiredLength = skirtLength * (1 + positive(room.skirtWaste) / 100);
  const sourceTileCount = stripsPerTile > 0 && tileLong > 0
    ? Math.ceil(skirtRequiredLength / (stripsPerTile * tileLong))
    : 0;
  const sourceArea = sourceTileCount * skirtTile.area;

  const floorCost = floorRequiredArea * positive(room.floorPrice);
  const wallCost = wallRequiredArea * positive(room.wallPrice);
  const skirtCost = room.skirtPriceMode === "m2"
    ? sourceArea * positive(room.skirtPrice)
    : skirtRequiredLength * positive(room.skirtPrice);

  return {
    perimeter,
    openingArea,
    openingWidth,
    floor: {
      area: floorArea,
      requiredArea: floorRequiredArea,
      tileCount: floorTileCount,
      cost: floorCost,
    },
    wall: {
      enabled: wallEnabled,
      area: wallArea,
      requiredArea: wallRequiredArea,
      tileCount: wallTileCount,
      cost: wallCost,
      typeResults,
    },
    skirt: {
      enabled: skirtEnabled,
      length: skirtLength,
      requiredLength: skirtRequiredLength,
      sourceTileCount,
      sourceArea,
      stripsPerTile,
      cost: skirtCost,
    },
    totalCost: floorCost + wallCost + skirtCost,
  };
}

export function calculateTotals(calculations: RoomCalculation[], groups?: MaterialGroup[]): CalculatorTotals {
  const totals = calculations.reduce<CalculatorTotals>((totals, calculation) => ({
    floorArea: totals.floorArea + calculation.floor.requiredArea,
    floorTiles: totals.floorTiles + calculation.floor.tileCount,
    wallArea: totals.wallArea + calculation.wall.requiredArea,
    wallTiles: totals.wallTiles + calculation.wall.tileCount,
    skirtLength: totals.skirtLength + calculation.skirt.requiredLength,
    skirtSourceTiles: totals.skirtSourceTiles + calculation.skirt.sourceTileCount,
    totalCost: totals.totalCost + calculation.totalCost,
  }), {
    floorArea: 0,
    floorTiles: 0,
    wallArea: 0,
    wallTiles: 0,
    skirtLength: 0,
    skirtSourceTiles: 0,
    totalCost: 0,
  });
  if (!groups) return totals;
  return {
    ...totals,
    floorTiles: groups.filter((group) => group.kind === "floor").reduce((sum, group) => sum + group.tileCount, 0),
    wallTiles: groups.filter((group) => group.kind === "wall").reduce((sum, group) => sum + group.tileCount, 0),
    skirtSourceTiles: groups.filter((group) => group.kind === "skirt").reduce((sum, group) => sum + group.tileCount, 0),
    totalCost: groups.reduce((sum, group) => sum + group.cost, 0),
  };
}

function sourceIdFor(room: TileRoom, kind: MaterialKind) {
  if (kind === "floor") return room.floorMaterialSourceId;
  if (kind === "wall") return room.wallMaterialSourceId;
  return room.skirtMaterialSourceId;
}

function positive(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function wholeQuantity(value: number) {
  return Number.isFinite(value) ? Math.min(999, Math.max(1, Math.floor(value))) : 1;
}
