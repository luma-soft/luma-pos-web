import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const migration = readFileSync("drizzle/0121_project_notes.sql", "utf8");
const schema = readFileSync("src/db/schema.ts", "utf8");

test("project notes are tenant-owned, constrained and backfill legacy notes", () => {
  expect(schema).toContain('export const projectNotes = pgTable("project_notes"');
  expect(migration).toContain('CREATE TABLE "project_notes"');
  expect(migration).toContain('FOREIGN KEY ("store_id", "project_id")');
  expect(migration).toContain('char_length(btrim("content")) > 0');
  expect(migration).not.toContain('substring("note"');
  expect(readFileSync("src/lib/mobile/project-note-access.ts", "utf8")).toContain(".max(5000)");
  expect(migration).toContain('INSERT INTO "project_notes"');
  expect(migration).toContain('FROM "projects"');
  expect(migration).toContain('ALTER TABLE "project_notes" ENABLE ROW LEVEL SECURITY');
  expect(migration).toContain('GRANT SELECT ON TABLE "project_notes" TO authenticated');
  expect(migration).not.toMatch(/FOR (?:UPDATE|INSERT|DELETE)\s+TO authenticated/i);
});
