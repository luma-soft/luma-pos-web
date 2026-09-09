import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { calculateRoom, type TileRoom } from "./tile-calculator-model";

function room(overrides: Partial<TileRoom> = {}): TileRoom {
  return {
    id: "room-1",
    name: "Phòng khách",
    quantity: 1,
    length: 5,
    width: 4,
    height: 2.8,
    floorTileSize: "0.6x0.6",
    wallTileSize: "0.3x0.6",
    wallOrientation: "horizontal",
    skirtSourceTile: "0.6x0.6",
    floorPrice: 0,
    floorWaste: 5,
    wallPrice: 0,
    wallWaste: 7,
    skirtPrice: 0,
    skirtWaste: 5,
    skirtPriceMode: "m",
    skirtHeight: 12,
    skirtEnabled: true,
    wallMultiType: false,
    openings: [],
    wallTypes: [],
    ...overrides,
  };
}

describe("calculateRoom quantities", () => {
  test("aggregates identical rooms before rounding tiles", () => {
    const result = calculateRoom(room({ quantity: 3 }));

    assert.equal(result.floor.area, 60);
    assert.equal(result.floor.requiredArea, 63);
    assert.equal(result.floor.tileCount, 175);
  });

  test("applies opening quantity inside every repeated room", () => {
    const result = calculateRoom(room({
      quantity: 3,
      openings: [{ id: "door", name: "Cửa chính", width: 0.9, height: 2.1, quantity: 2 }],
    }));

    assert.ok(Math.abs(result.openingArea - 3.78) < 0.0001);
    assert.ok(Math.abs(result.wall.area - 139.86) < 0.0001);
    assert.ok(Math.abs(result.skirt.length - 48.6) < 0.0001);
  });

  test("normalizes invalid quantities to the supported range", () => {
    assert.equal(calculateRoom(room({ quantity: 0 })).floor.area, 20);
    assert.equal(calculateRoom(room({ quantity: 2.9 })).floor.area, 40);
    assert.equal(calculateRoom(room({ quantity: 2000 })).floor.area, 19980);
  });
});
