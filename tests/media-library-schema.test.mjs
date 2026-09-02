import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const sql = readFileSync("drizzle/0120_media_library.sql", "utf8");

test("media library migration is tenant-owned and read-only through the Data API", () => {
  expect(sql).toContain('CREATE TABLE "media_library_items"');
  expect(sql).toContain('"store_id" uuid NOT NULL');
  expect(sql).toContain('REFERENCES "media_objects"("store_id","id") ON DELETE NO ACTION');
  expect(sql).toContain('ALTER TABLE "media_library_items" ENABLE ROW LEVEL SECURITY');
  expect(sql).toContain('REVOKE ALL PRIVILEGES ON TABLE "media_library_items" FROM authenticated');
  expect(sql).toContain('GRANT SELECT ON TABLE "media_library_items" TO authenticated');
  expect(sql).toContain('USING (store_id = public.current_active_store_id())');
  expect(sql).not.toMatch(/FOR (?:UPDATE|INSERT|DELETE) TO authenticated/i);
});

test("media library migration accepts the new purpose and protects ready references", () => {
  expect(sql).toContain("'library-asset'");
  expect(sql).toContain("CREATE TRIGGER media_library_items_ready_media_reference");
  expect(sql).toContain("MEDIA_LIBRARY_REFERENCE_INVALID");
  expect(sql).toContain("AND purpose = 'library-asset'");
  expect(sql).toContain("AND target_id = NEW.store_id");
  expect(sql).toContain("REVOKE ALL ON FUNCTION public.guard_ready_library_media_reference() FROM PUBLIC");
  expect(sql).toContain("WHEN (NEW.deleted_at IS NULL)");
  expect(sql).toContain("media_library_items_media_unique");
});
