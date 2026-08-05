import { describe, expect, test } from "bun:test";
import { serializeMovementCreatedAt } from "@/lib/inventory/movement-serialization";

describe("inventory movement serialization", () => {
  test("accepts a Date returned directly by the database", () => {
    expect(
      serializeMovementCreatedAt(new Date("2026-08-05T00:36:54.000Z")),
    ).toBe("2026-08-05T00:36:54.000Z");
  });

  test("accepts an ISO string restored from the Next.js cache", () => {
    expect(serializeMovementCreatedAt("2026-08-05T00:36:54.000Z")).toBe(
      "2026-08-05T00:36:54.000Z",
    );
  });
});
