import { describe, expect, test } from "bun:test";
import {
  aiEntitySearchTerms,
  matchAiInboundProduct,
  resolveAiProductUnit,
  type AiProductCandidate,
} from "@/lib/ai/entity-matching";

function product(input: Partial<AiProductCandidate> & Pick<AiProductCandidate, "id" | "sku" | "name">): AiProductCandidate {
  return {
    barcode: null,
    baseUnit: "Chiếc",
    costPrice: 0,
    lastPurchasePrice: 0,
    retailPrice: 0,
    categoryId: null,
    brandId: null,
    minStock: 0,
    units: [],
    supplierSkus: [],
    ...input,
  };
}

const splitter = product({
  id: "splitter",
  sku: "SPMSO4U3CLPXX",
  name: "Bộ chuyển đổi POE sang 12V SPLITTER",
});

describe("AI entity candidates", () => {
  test("keeps supplier SKU and model tokens as targeted search terms", () => {
    const terms = aiEntitySearchTerms([
      "829GLBZ001.NV · Bộ chuyển đổi POE sang 12V SPLITTER",
      "Camera Ezviz CS-H6C G1-5MP",
    ]).map((term) => term.toLowerCase());
    expect(terms).toContain("829glbz001.nv");
    expect(terms).toContain("splitter");
    expect(terms).toContain("h6c");
    expect(terms).toContain("5mp");
  });

  test("matches internal SKU before other strategies", () => {
    const result = matchAiInboundProduct(
      { text: splitter.name, sku: splitter.sku, confidence: 0.7 },
      [splitter],
    );
    expect(result.product?.id).toBe("splitter");
    expect(result.matchedBy).toBe("internal_sku");
  });

  test("matches a configured supplier SKU", () => {
    const result = matchAiInboundProduct(
      { text: "Tên trên phiếu", sku: "829GLBZ001.NV", confidence: 0.7 },
      [{ ...splitter, supplierSkus: ["829GLBZ001.NV"] }],
    );
    expect(result.product?.id).toBe("splitter");
    expect(result.matchedBy).toBe("supplier_sku");
  });

  test("preserves a supplier unit conversion instead of falling back to base unit", () => {
    const cable = product({
      id: "cable-unit",
      sku: "504585",
      name: "Dây mạng TAESUNG Cat5E UTP",
      baseUnit: "m",
      units: [{ unitName: "cuộn", multiplier: 305 }],
    });
    expect(resolveAiProductUnit(cable, "Cuộn")).toEqual({ unitName: "cuộn", multiplier: 305 });
    expect(resolveAiProductUnit(cable, "m")).toEqual({ unitName: "m", multiplier: 1 });
  });

  test("falls back to a confident name when supplier SKU is not configured", () => {
    const result = matchAiInboundProduct(
      { text: "Bộ chuyển đổi POE sang 12V SPLITTER", sku: "829GLBZ001.NV", confidence: 0.78 },
      [splitter],
    );
    expect(result.product?.id).toBe("splitter");
    expect(result.matchedBy).toBe("name");
  });

  test("matches verbose OCR names to a concise catalog name", () => {
    const cable = product({
      id: "cable",
      sku: "504585",
      name: "Dây mạng TAESUNG Cat5E UTP đồng 0.45mm, 305m/cuộn",
      baseUnit: "Cuộn",
    });
    const camera = product({
      id: "camera",
      sku: "EZ-H6CG1-5MP",
      name: "EZVIZ H6C G1 3K 5MP",
    });
    const cableDistractor = product({
      id: "cable-distractor",
      sku: "SP001415",
      name: "Ê Cu Trắng - 8",
    });
    const cameraDistractor = product({
      id: "camera-distractor",
      sku: "EZ-H6CP-5MP",
      name: "EZVIZ H6C Pro 3K 5MP",
    });
    const cableResult = matchAiInboundProduct({
      text: "Dây mạng CAT5 TAESUNG Cat5E UTP, Đồng không bù 8 lõi, CU 0.45, Vỏ xanh lá cây, Dây trắng, 305m/Cuộn",
      sku: "707TAES006.NV",
      confidence: 0.78,
    }, [cable, camera, cableDistractor, cameraDistractor]);
    const cameraResult = matchAiInboundProduct({
      text: "Camera Ezviz CS-H6C G1-5MP, IP WiFi Trong nhà Quay quét có màu, 3K Ultra HD",
      sku: "810EZVZ115",
      confidence: 0.78,
    }, [cable, camera, cableDistractor, cameraDistractor]);
    expect(cableResult.product?.id).toBe("cable");
    expect(cameraResult.product?.id).toBe("camera");
  });

  test("does not select a different switch when brand and model do not match", () => {
    const result = matchAiInboundProduct(
      {
        text: "Switch POE TORUK 10/100Mps, TR-4F2F-65, 4 Cổng + 2 Uplink, Bảo hành 24 Tháng",
        sku: "702TRKZ001",
        confidence: 0.78,
      },
      [product({
        id: "sinic",
        sku: "SNIC-3104",
        name: "Switch PoE SinicHome SINIC-3104POE (4 PoE + 2 uplink)",
      })],
    );
    expect(result.product).toBeNull();
    expect(result.matchedBy).toBeNull();
  });

  test("returns ambiguity instead of silently choosing equal name candidates", () => {
    const result = matchAiInboundProduct(
      { text: splitter.name, sku: "EXTERNAL-001", confidence: 0.7 },
      [splitter, { ...splitter, id: "splitter-2", sku: "OTHER" }],
    );
    expect(result.product).toBeNull();
    expect(result.ambiguous.map((item) => item.id)).toEqual(["splitter", "splitter-2"]);
  });
});
