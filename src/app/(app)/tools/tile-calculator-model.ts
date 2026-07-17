export const DEFAULT_WASTE = 5;
export const DEFAULT_SKIRT_HEIGHT = 12;

export const FLOOR_TILE_SIZES = [
  "0.3x0.3",
  "0.4x0.4",
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
  "0.4x0.8",
  "0.6x0.6",
  "0.6x1.2",
] as const;

export const SKIRT_TILE_SIZES = FLOOR_TILE_SIZES;

export type WallOrientation = "horizontal" | "vertical";
export type SkirtPriceMode = "m" | "m2";

export interface Opening {
  id: string;
  name: string;
  width: number;
  height: number;
}

export interface WallType {
  id: string;
  name: string;
  rows: number;
}

export interface TileRoom {
  id: string;
  name: string;
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
  const length = positive(room.length);
  const width = positive(room.width);
  const height = positive(room.height);
  const perimeter = 2 * (length + width);
  const floorArea = length * width;

  const openingArea = room.openings.reduce(
    (sum, opening) => sum + positive(opening.width) * positive(opening.height),
    0,
  );
  const openingWidth = room.openings.reduce(
    (sum, opening) => sum + positive(opening.width),
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
    const tileCount = tilesPerRow * rows;
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
  const wallArea = wallEnabled ? Math.max(0, perimeter * wallHeight - openingArea) : 0;

  const skirtEnabled = room.skirtEnabled;
  const skirtLength = skirtEnabled ? Math.max(0, perimeter - openingWidth) : 0;

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

export function calculateTotals(calculations: RoomCalculation[]): CalculatorTotals {
  return calculations.reduce<CalculatorTotals>((totals, calculation) => ({
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
}

function positive(value: number) {
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}
