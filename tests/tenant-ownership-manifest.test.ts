import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { TABLE_OWNERSHIP } from "@/lib/tenancy/table-ownership";

describe("tenant ownership manifest", () => {
  test("classifies every Drizzle application table exactly once", () => {
    const schemaSource = readFileSync(
      new URL("../src/db/schema.ts", import.meta.url),
      "utf8",
    );
    const schemaTables = [
      ...schemaSource.matchAll(/pgTable\("([^"]+)"/g),
    ].map((match) => match[1]);
    const uniqueSchemaTables = new Set(schemaTables);
    const manifestTables = new Set(Object.keys(TABLE_OWNERSHIP));

    expect(schemaTables).toHaveLength(uniqueSchemaTables.size);
    expect([...manifestTables].sort()).toEqual([...uniqueSchemaTables].sort());
  });
});
