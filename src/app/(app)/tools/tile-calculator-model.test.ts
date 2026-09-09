import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  FLOOR_TILE_SIZES,
  WALL_TILE_SIZES,
  calculateMaterialGroups,
  calculateRoom,
  resolveRoomMaterials,
  type TileRoom,
} from "./tile-calculator-model";

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
    floorMaterialSourceId: "",
    wallMaterialSourceId: "",
    skirtMaterialSourceId: "",
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

describe("shared material groups", () => {
  test("inherits floor material without inheriting room dimensions", () => {
    const rooms = [
      room({ id: "room-1", length: 1, width: 1, floorTileSize: "0.4x0.6", floorPrice: 120000 }),
      room({ id: "room-2", length: 2, width: 3, floorTileSize: "0.8x0.8", floorMaterialSourceId: "room-1" }),
    ];

    const effective = resolveRoomMaterials(rooms);
    assert.equal(effective[1].length, 2);
    assert.equal(effective[1].width, 3);
    assert.equal(effective[1].floorTileSize, "0.4x0.6");
    assert.equal(effective[1].floorPrice, 120000);
  });

  test("aggregates linked rooms before rounding and keeps independent rooms separate", () => {
    const rooms = [
      room({ id: "room-1", length: 1, width: 1, floorTileSize: "0.4x0.6" }),
      room({ id: "room-2", length: 1, width: 1, floorMaterialSourceId: "room-1" }),
      room({ id: "room-3", length: 1, width: 1 }),
      room({ id: "room-4", length: 1, width: 1 }),
      room({ id: "room-5", length: 1, width: 1 }),
    ];
    const effective = resolveRoomMaterials(rooms);
    const calculations = effective.map(calculateRoom);
    const floorGroups = calculateMaterialGroups(rooms, effective, calculations)
      .filter((group) => group.kind === "floor");

    assert.equal(floorGroups.length, 4);
    assert.deepEqual(floorGroups[0].roomIds, ["room-1", "room-2"]);
    assert.equal(floorGroups[0].tileCount, 9);
  });

  test("offers the 40 x 60 size for floor and wall tiles", () => {
    assert.ok(FLOOR_TILE_SIZES.includes("0.4x0.6"));
    assert.ok(WALL_TILE_SIZES.includes("0.4x0.6"));
  });
});
