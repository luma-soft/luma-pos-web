// @ts-expect-error bun:test types are provided by the Bun test runtime, not this Next.js app.
import { describe, expect, test } from "bun:test";
import {
  calculateRoom,
  calculateTotals,
  tileSizeLabel,
  type TileRoom,
} from "../src/app/(app)/tools/tile-calculator-model";

function room(overrides: Partial<TileRoom> = {}): TileRoom {
  return {
    id: "room-test",
    name: "Test room",
    length: 5,
    width: 4,
    height: 0,
    floorTileSize: "0.6x0.6",
    wallTileSize: "0.3x0.6",
    wallOrientation: "horizontal",
    skirtSourceTile: "0.6x0.6",
    floorPrice: 100_000,
    floorWaste: 5,
    wallPrice: 120_000,
    wallWaste: 5,
    skirtPrice: 50_000,
    skirtWaste: 5,
    skirtPriceMode: "m",
    skirtHeight: 12,
    skirtEnabled: true,
    wallMultiType: false,
    openings: [{ id: "door", name: "Door", width: 0.9, height: 2.1 }],
    wallTypes: [],
    ...overrides,
  };
}

describe("tile calculator", () => {
  test("formats tile dimensions in centimeters", () => {
    expect(tileSizeLabel("0.6x1.2")).toBe("60 × 120 cm");
  });

  test("calculates floor and skirting procurement with waste", () => {
    const result = calculateRoom(room());

    expect(result.floor.area).toBe(20);
    expect(result.floor.requiredArea).toBe(21);
    expect(result.floor.tileCount).toBe(59);
    expect(result.skirt.length).toBeCloseTo(17.1);
    expect(result.skirt.requiredLength).toBeCloseTo(17.955);
    expect(result.skirt.stripsPerTile).toBe(5);
    expect(result.skirt.sourceTileCount).toBe(6);
    expect(result.wall.enabled).toBe(false);
  });

  test("calculates multi-type wall rows and deducts openings", () => {
    const result = calculateRoom(room({
      length: 2.5,
      width: 2,
      height: 2.4,
      wallMultiType: true,
      openings: [{ id: "door", name: "Door", width: 0.7, height: 2 }],
      wallTypes: [
        { id: "dark", name: "Dark", rows: 2 },
        { id: "accent", name: "Accent", rows: 1 },
        { id: "light", name: "Light", rows: 5 },
      ],
    }));

    expect(result.perimeter).toBe(9);
    expect(result.wall.area).toBeCloseTo(20.2);
    expect(result.wall.requiredArea).toBeCloseTo(21.21);
    expect(result.wall.typeResults[0].tilesPerRow).toBe(15);
    expect(result.wall.tileCount).toBe(120);
  });

  test("aggregates procurement totals across rooms", () => {
    const first = calculateRoom(room());
    const second = calculateRoom(room({ id: "second", length: 2, width: 2, skirtEnabled: false }));
    const totals = calculateTotals([first, second]);

    expect(totals.floorArea).toBeCloseTo(25.2);
    expect(totals.floorTiles).toBe(71);
    expect(totals.skirtSourceTiles).toBe(6);
    expect(totals.totalCost).toBeCloseTo(first.totalCost + second.totalCost);
  });
});
