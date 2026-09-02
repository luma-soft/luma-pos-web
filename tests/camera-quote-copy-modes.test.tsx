import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { CameraPriceListClient } from "@/app/(app)/camera-price-list/camera-price-list-client";
import { cameraQuoteCopyLayout } from "@/lib/camera-quote-copy";

const model = {
  id: "camera-1",
  model: "EZVIZ C6N G1 2K 3MP",
  description: "Camera trong nhà",
  imageUrl: null,
  specs: { "Độ phân giải": ["3MP"] },
  installationLocation: "Trong nhà" as const,
  suitableFor: ["Phòng khách"],
  variants: [
    {
      id: "camera-1:card-32",
      cameraId: "camera-1",
      cardId: "card-32",
      cameraPrice: 520_000,
      cardPrice: 250_000,
      installationPrice: 200_000,
      materialPrice: 50_000,
      price: 1_020_000,
      storageEstimate: "~2–2 ngày",
    },
    {
      id: "camera-1:card-64",
      cameraId: "camera-1",
      cardId: "card-64",
      cameraPrice: 520_000,
      cardPrice: 300_000,
      installationPrice: 200_000,
      materialPrice: 50_000,
      price: 1_070_000,
      storageEstimate: "~3–5 ngày",
    },
  ],
};

describe("camera quote copy modes", () => {
  test("keeps prices out of camera-only copies", () => {
    expect(cameraQuoteCopyLayout("camera-only")).toEqual({
      showPriceSummary: false,
      showPriceBreakdown: false,
    });
  });

  test("shows package totals without the detailed table in summary copies", () => {
    expect(cameraQuoteCopyLayout("price-summary")).toEqual({
      showPriceSummary: true,
      showPriceBreakdown: false,
    });
  });

  test("shows both price sections in full copies", () => {
    expect(cameraQuoteCopyLayout("full")).toEqual({
      showPriceSummary: true,
      showPriceBreakdown: true,
    });
  });
});

describe("camera quote copy and price controls", () => {
  test("keeps desktop camera rows comfortably tall", () => {
    const html = renderToStaticMarkup(
      <CameraPriceListClient
        models={[model]}
        memoryLabels={["Thẻ nhớ 32GB", "Thẻ nhớ 64GB"]}
        canEdit
        brandName="EZVIZ"
      />,
    );

    expect(html).toMatch(
      /data-testid="camera-price-list-row"[^>]*class="[^"]*\bh-16\b/,
    );
  });

  test("uses the full desktop price cell as the edit control", () => {
    const html = renderToStaticMarkup(
      <CameraPriceListClient
        models={[model]}
        memoryLabels={["Thẻ nhớ 32GB", "Thẻ nhớ 64GB"]}
        canEdit
        brandName="EZVIZ"
      />,
    );
    const desktopTableStart = html.indexOf(
      'data-testid="camera-price-list-row"',
    );
    const desktopTableEnd = html.indexOf("</table>", desktopTableStart);
    const desktopTable = html.slice(desktopTableStart, desktopTableEnd);
    const editablePriceCells =
      desktopTable.match(
        /<button[^>]*data-testid="camera-price-edit-cell"[^>]*>.*?<\/button>/g,
      ) ?? [];

    expect(editablePriceCells).toHaveLength(2);
    expect(desktopTable).toContain(
      'aria-label="Sửa giá EZVIZ C6N G1 2K 3MP · Thẻ nhớ 32GB"',
    );
    expect(desktopTable).toContain(
      'aria-label="Sửa giá EZVIZ C6N G1 2K 3MP · Thẻ nhớ 64GB"',
    );
    expect(editablePriceCells.every((cell) => !cell.includes("<svg"))).toBe(true);
  });

  test("renders one accessible three-mode copy trigger on every camera surface", () => {
    const html = renderToStaticMarkup(
      <CameraPriceListClient
        models={[model]}
        memoryLabels={["Thẻ nhớ 32GB", "Thẻ nhớ 64GB"]}
        canEdit
        brandName="EZVIZ"
      />,
    );

    expect(html.match(/aria-haspopup="menu"/g)).toHaveLength(3);
    expect(html.match(/aria-label="Chọn kiểu sao chép EZVIZ C6N G1 2K 3MP"/g)).toHaveLength(3);
  });

  test("lets editors change each package total from the prominent price cards", () => {
    const html = renderToStaticMarkup(
      <CameraPriceListClient
        models={[model]}
        memoryLabels={["Thẻ nhớ 32GB", "Thẻ nhớ 64GB"]}
        canEdit
        brandName="EZVIZ"
      />,
    );
    const priceCardsStart = html.indexOf('data-testid="camera-package-total-prices"');
    const specsStart = html.indexOf("THÔNG SỐ KỸ THUẬT", priceCardsStart);
    const priceCards = html.slice(priceCardsStart, specsStart);

    expect(priceCardsStart).toBeGreaterThan(-1);
    expect(specsStart).toBeGreaterThan(priceCardsStart);
    expect(priceCards).toContain('aria-label="Sửa tổng giá Thẻ nhớ 32GB"');
    expect(priceCards).toContain('aria-label="Sửa tổng giá Thẻ nhớ 64GB"');
  });

  test("does not expose package-total edit controls to viewers", () => {
    const html = renderToStaticMarkup(
      <CameraPriceListClient
        models={[model]}
        memoryLabels={["Thẻ nhớ 32GB", "Thẻ nhớ 64GB"]}
        canEdit={false}
        brandName="EZVIZ"
      />,
    );

    expect(html).not.toContain("Sửa tổng giá");
  });
});
