import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL("./settings-client.tsx", import.meta.url),
  "utf8",
);

test("camera quote settings uses the shared table for camera prices", () => {
  expect(source).toContain('import { DataTableShell, type DataTableColumn } from "@/components/data-table";');
  expect(source).toContain('tableId="settings.camera-quote.cameras"');
  expect(source).toContain("columns={cameraColumns}");
  expect(source).toContain('key: "retailPrice"');
  expect(source).toContain('key: "quotePrice"');
});

test("IP quote settings are not rendered in the central camera settings screen", () => {
  expect(source).not.toContain('title={L ? "Báo giá camera IP"');
  expect(source).not.toContain('title={L ? "IP camera quote"');
});
