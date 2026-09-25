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
  expect(source).toContain('const t = useTranslations("settings.cameraQuote");');
  expect(source).toContain('tableId="settings.camera-quote.memory-cards"');
  expect(source).toContain('tableId="settings.camera-quote.installation"');
  expect(source).toContain('title={t("ip.title")}');
  expect(source).toContain('tableId="settings.camera-quote.ip-cameras"');
  expect(source).toContain('tableId="settings.camera-quote.ip-recorders"');
  expect(source).toContain('tableId="settings.camera-quote.ip-storage"');
  expect(source).toContain('tableId="settings.camera-quote.ip-accessories"');
  expect(source).not.toContain("Thẻ nhớ mặc định");
});

test("Wi-Fi cameras are kept above the dedicated IP quote section", () => {
  expect(source).toContain("const ipCameraSkus = new Set<string>(Object.values(CAMERA_IP_QUOTE_LEGACY_SKUS.camera));");
  expect(source).toContain("const wifiCameras = options.cameras.filter");
  expect(source).toContain("const visibleCameras = wifiCameras.filter");
  expect(source).toContain('title={t("wifi.title")}');
  expect(source).toContain('title={t("ip.title")}');
});

test("installation pricing is rendered as a following row in the aligned table", () => {
  expect(source).toContain('renderFollowingRows={(profile, visibleColumns) =>');
  expect(source).toContain('t("installation.labor")');
  expect(source).toContain('minWidth="640px"');
  expect(source).toContain('label: rightHeader(t("installation.costPrice"))');
});

test("mobile quote rows keep price and picker labels visible", () => {
  expect(source).toContain('renderMobileRow={({ row }) =>');
  expect(source).toContain('t("wifi.product")');
  expect(source).toContain('t("installation.material")');
  expect(source).toContain('t("installation.labor")');
  expect(source).toContain('t("wifi.salePrice")');
  expect(source).not.toContain('L ? "Camera Wifi" : "Available cameras"');
});
