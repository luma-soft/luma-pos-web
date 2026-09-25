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
  expect(source).toContain('key: "costPrice"');
  expect(source).toContain('key: "quotePrice"');
});

test("memory, installation, and IP quote settings stay in table sections", () => {
  expect(source).toContain('tableId="settings.camera-quote.memory-cards"');
  expect(source).toContain('tableId="settings.camera-quote.installation"');
  expect(source).toContain('title={L ? "Báo giá camera IP"');
  expect(source).toContain('tableId="settings.camera-quote.ip-cameras"');
  expect(source).toContain('tableId="settings.camera-quote.ip-recorders"');
  expect(source).toContain('tableId="settings.camera-quote.ip-storage"');
  expect(source).toContain('tableId="settings.camera-quote.ip-accessories"');
  expect(source).not.toContain("Thẻ nhớ mặc định");
});

test("mobile quote rows keep price and picker labels visible", () => {
  expect(source).toContain('renderMobileRow={({ row }) =>');
  expect(source).toContain('L ? "Sản phẩm" : "Product"');
  expect(source).toContain('L ? "Vật tư" : "Material"');
  expect(source).toContain('L ? "Công lắp đặt" : "Installation"');
  expect(source).toContain('L ? "Giá bán" : "Sale price"');
});
