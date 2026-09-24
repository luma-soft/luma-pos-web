import {
  CAMERA_QUOTE_CARD_SKUS,
  CAMERA_QUOTE_DEFAULT_CARD_SKU,
  CAMERA_QUOTE_INSTALL_SKUS,
  CAMERA_QUOTE_MATERIAL_SKUS,
} from "@/lib/data/camera-quote-constants";
import type { CameraQuotePrefs } from "@/lib/schemas/settings";

export type CameraQuoteSettings = CameraQuotePrefs;

type ProductLike = {
  id: string;
  sku: string | null | undefined;
};

export type CameraQuoteProductGroups<T extends ProductLike> = {
  cards: T[];
  installations: T[];
  materials: T[];
};

export type CameraQuoteDefaults<T extends ProductLike> = {
  cards: T[];
  defaultCard: T | undefined;
  indoorMaterial: T | undefined;
  outdoorMaterial: T | undefined;
  ptzMaterial: T | undefined;
  indoorInstallation: T | undefined;
  outdoorInstallation: T | undefined;
  ptzInstallation: T | undefined;
};

export type CameraQuoteInstallationProfile = "indoor" | "outdoor" | "ptz";

function byId<T extends ProductLike>(
  products: T[],
  id: string | null | undefined,
) {
  return id ? products.find((product) => product.id === id) : undefined;
}

function bySku<T extends ProductLike>(products: T[], sku: string) {
  return products.find((product) => product.sku === sku);
}

function configuredOrLegacy<T extends ProductLike>(
  products: T[],
  configuredId: string | null,
  legacySku: string,
) {
  return (
    byId(products, configuredId) ?? bySku(products, legacySku) ?? products[0]
  );
}

/** Resolve saved product selections while keeping old stores working. */
export function resolveCameraQuoteDefaults<T extends ProductLike>(
  groups: CameraQuoteProductGroups<T>,
  settings: CameraQuoteSettings,
): CameraQuoteDefaults<T> {
  const cards =
    settings.memoryCardProductIds === null
      ? CAMERA_QUOTE_CARD_SKUS.map((sku) => bySku(groups.cards, sku)).filter(
          (product): product is T => Boolean(product),
        )
      : settings.memoryCardProductIds
          .map((id) => byId(groups.cards, id))
          .filter((product): product is T => Boolean(product));

  const defaultCard =
    byId(cards, settings.defaultMemoryCardProductId) ??
    bySku(cards, CAMERA_QUOTE_DEFAULT_CARD_SKU) ??
    cards[0];

  return {
    cards,
    defaultCard,
    indoorMaterial: configuredOrLegacy(
      groups.materials,
      settings.indoorMaterialProductId,
      CAMERA_QUOTE_MATERIAL_SKUS[0],
    ),
    outdoorMaterial: configuredOrLegacy(
      groups.materials,
      settings.outdoorMaterialProductId,
      CAMERA_QUOTE_MATERIAL_SKUS[1],
    ),
    ptzMaterial: configuredOrLegacy(
      groups.materials,
      settings.ptzMaterialProductId,
      CAMERA_QUOTE_MATERIAL_SKUS[2],
    ),
    indoorInstallation: configuredOrLegacy(
      groups.installations,
      settings.indoorInstallationProductId,
      CAMERA_QUOTE_INSTALL_SKUS[0],
    ),
    outdoorInstallation: configuredOrLegacy(
      groups.installations,
      settings.outdoorInstallationProductId,
      CAMERA_QUOTE_INSTALL_SKUS[1],
    ),
    ptzInstallation: configuredOrLegacy(
      groups.installations,
      settings.ptzInstallationProductId,
      CAMERA_QUOTE_INSTALL_SKUS[2],
    ),
  };
}

export function cameraQuotePrice(
  productId: string | null | undefined,
  retailPrice: number,
  settings: CameraQuoteSettings,
) {
  const override = productId ? settings.priceOverrides[productId] : undefined;
  return typeof override === "number" &&
    Number.isFinite(override) &&
    override >= 0
    ? override
    : retailPrice;
}

export function cameraQuoteInstallationProfile(
  name: string,
  specs: Record<string, string[]> = {},
): CameraQuoteInstallationProfile {
  const text =
    `${name} ${Object.values(specs).flat().join(" ")}`.toLocaleLowerCase("vi");
  if (/ptz|xoay|speed dome|xoay quét/.test(text)) return "ptz";
  if (
    /\bip(?:65|66|67)\b/.test(text) ||
    /\b(?:h3|h8|h9|h80|f32|k7)/i.test(name)
  )
    return "outdoor";
  return "indoor";
}

export function cameraQuoteProfileProducts<T extends ProductLike>(
  defaults: CameraQuoteDefaults<T>,
  profile: CameraQuoteInstallationProfile,
) {
  if (profile === "ptz") {
    return {
      installation: defaults.ptzInstallation,
      material: defaults.ptzMaterial,
    };
  }
  if (profile === "outdoor") {
    return {
      installation: defaults.outdoorInstallation,
      material: defaults.outdoorMaterial,
    };
  }
  return {
    installation: defaults.indoorInstallation,
    material: defaults.indoorMaterial,
  };
}
