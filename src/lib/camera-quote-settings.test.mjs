import { describe, expect, test } from "bun:test";
import {
  cameraQuoteInstallationProfile,
  cameraQuotePrice,
  groupCameraQuoteCardsByCapacity,
  resolveCameraIpQuoteDefaults,
  resolveCameraQuoteDefaults,
} from "./camera-quote-settings.ts";

const products = {
  cards: [
    { id: "card-32", sku: "MEM-HIK-32GB", retailPrice: 250000 },
    { id: "card-64", sku: "SP7F7D2202241D-A832AE", retailPrice: 355000 },
    { id: "card-128", sku: "MEM-KIOXIA-128GB", retailPrice: 445000 },
  ],
  installations: [
    { id: "install-in", sku: "SVC-CAM-INSTALL-200", retailPrice: 200000 },
    { id: "install-out", sku: "SVC-CAM-INSTALL-250", retailPrice: 250000 },
    { id: "install-ptz", sku: "SVC-CAM-INSTALL-300", retailPrice: 300000 },
  ],
  materials: [
    { id: "material-in", sku: "MAT-CAM-BASIC-50", retailPrice: 50000 },
    { id: "material-out", sku: "MAT-CAM-OUT-80", retailPrice: 80000 },
    { id: "material-ptz", sku: "MAT-CAM-PTZ-100", retailPrice: 100000 },
  ],
};

const defaults = {
  memoryCardProductIds: null,
  defaultMemoryCardProductId: null,
  indoorMaterialProductId: null,
  outdoorMaterialProductId: null,
  ptzMaterialProductId: null,
  indoorInstallationProductId: null,
  outdoorInstallationProductId: null,
  ptzInstallationProductId: null,
  priceOverrides: {},
};

describe("camera quote settings", () => {
  test("keeps legacy product defaults when no settings were saved", () => {
    const resolved = resolveCameraQuoteDefaults(products, defaults);

    expect(resolved.cards.map((product) => product.id)).toEqual(["card-32", "card-64", "card-128"]);
    expect(resolved.defaultCard?.id).toBe("card-64");
    expect(resolved.indoorInstallation?.id).toBe("install-in");
    expect(resolved.outdoorInstallation?.id).toBe("install-out");
    expect(resolved.ptzInstallation?.id).toBe("install-ptz");
  });

  test("uses selected products and quote-only price overrides", () => {
    const resolved = resolveCameraQuoteDefaults(products, {
      ...defaults,
      memoryCardProductIds: ["card-128"],
      defaultMemoryCardProductId: "card-128",
      outdoorInstallationProductId: "install-ptz",
      priceOverrides: { "card-128": 399000 },
    });

    expect(resolved.cards.map((product) => product.id)).toEqual(["card-128"]);
    expect(resolved.defaultCard?.id).toBe("card-128");
    expect(resolved.outdoorInstallation?.id).toBe("install-ptz");
    expect(cameraQuotePrice("card-128", 445000, { ...defaults, priceOverrides: { "card-128": 399000 } })).toBe(399000);
    expect(cameraQuotePrice("card-64", 355000, defaults)).toBe(355000);
  });

  test("classifies PTZ and outdoor cameras separately", () => {
    expect(cameraQuoteInstallationProfile("Hikvision PTZ camera", {})).toBe("ptz");
    expect(cameraQuoteInstallationProfile("EZVIZ H3C", {})).toBe("outdoor");
    expect(cameraQuoteInstallationProfile("EZVIZ C6N", {})).toBe("indoor");
  });

  test("groups memory cards by capacity and keeps one selected SKU per capacity", () => {
    const groups = groupCameraQuoteCardsByCapacity([
      { id: "card-64-a", sku: "CARD-A", name: "Lexar xanh 64GB", specs: {} },
      { id: "card-32", sku: "CARD-32", name: "Hikvision 32GB", specs: { "Dung lượng": ["32GB"] } },
      { id: "card-64-b", sku: "CARD-B", name: "Kioxia 64GB", specs: { "Dung lượng": ["64 GB"] } },
    ]);

    expect(groups.map(([capacity, cards]) => [capacity, cards.map((card) => card.id)])).toEqual([
      ["32GB", ["card-32"]],
      ["64GB", ["card-64-a", "card-64-b"]],
    ]);
  });

  test("resolves central IP quote products from saved IDs and legacy SKUs", () => {
    const ipProducts = [
      { id: "ip-camera-2", sku: "HK-IP-DS2CD1023G2-LIUF", retailPrice: 700000 },
      { id: "ip-camera-4", sku: "HK-IP-DS2CD1043G2-LIUF", retailPrice: 900000 },
      { id: "ip-camera-custom", sku: "HK-CUSTOM-CAMERA", retailPrice: 1200000 },
      { id: "ip-cable", sku: "504585", retailPrice: 12000 },
      { id: "ip-storage", sku: "SG-SKYHAWK-2TB", retailPrice: 1800000 },
    ];

    const resolved = resolveCameraIpQuoteDefaults(ipProducts, {
      cameraProductIds: { bullet4: "ip-camera-custom" },
      cableProductId: "ip-cable",
      storageProductIds: { "2": "ip-storage" },
    });

    expect(resolved.cameras.bullet4?.id).toBe("ip-camera-custom");
    expect(resolved.cable?.id).toBe("ip-cable");
    expect(resolved.storage["2"]?.id).toBe("ip-storage");
    expect(resolved.cameras.bullet2?.sku).toBe("HK-IP-DS2CD1023G2-LIUF");
  });
});
