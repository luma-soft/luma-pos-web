import {
  CAMERA_QUOTE_CARD_SKUS,
  CAMERA_QUOTE_DEFAULT_CARD_SKU,
  CAMERA_QUOTE_INSTALL_SKUS,
  CAMERA_QUOTE_MATERIAL_SKUS,
} from "@/lib/data/camera-quote-constants";
import {
  CAMERA_IP_QUOTE_CAMERA_TYPES,
  CAMERA_IP_QUOTE_LEGACY_SKUS,
  CAMERA_IP_QUOTE_STORAGE_SIZES,
  type CameraIpQuoteCameraType,
} from "@/lib/data/camera-ip-quote";
import type { CameraIpQuotePrefs, CameraQuotePrefs } from "@/lib/schemas/settings";

export type CameraQuoteSettings = CameraQuotePrefs;

type ProductLike = {
  id: string;
  sku: string | null | undefined;
};

type NamedProductLike = ProductLike & {
  name?: string | null;
  specs?: Record<string, string[]>;
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

export type CameraIpQuoteDefaults<T extends ProductLike> = {
  cameras: Record<CameraIpQuoteCameraType, T | undefined>;
  recorders: Record<string, T | undefined>;
  switches: Record<string, T | undefined>;
  storage: Record<string, T | undefined>;
  material: T | undefined;
  installation: T | undefined;
  cable: T | undefined;
  ups: T | undefined;
  rack: T | undefined;
  monitor: T | undefined;
  surge: T | undefined;
};

export type CameraQuoteInstallationProfile = "indoor" | "outdoor" | "ptz";

export const CAMERA_QUOTE_MEMORY_CAPACITIES = [
  "32GB",
  "64GB",
  "128GB",
  "512GB",
] as const;

export function cameraQuoteMemoryCapacity(product: NamedProductLike) {
  const specText = Object.entries(product.specs ?? {})
    .filter(([key]) => key.trim().toLocaleLowerCase("vi") === "dung lượng")
    .flatMap(([, values]) => values)
    .join(" ");
  const text = `${specText} ${product.name ?? ""} ${product.sku ?? ""}`;
  const match = text.match(/\b(32|64|128|512)\s*GB\b/i);
  return match ? `${match[1]}GB` : null;
}

export function groupCameraQuoteCardsByCapacity<T extends NamedProductLike>(cards: T[]) {
  const groups = new Map<string, T[]>();
  for (const card of cards) {
    const capacity = cameraQuoteMemoryCapacity(card);
    if (!capacity) continue;
    const current = groups.get(capacity) ?? [];
    current.push(card);
    groups.set(capacity, current);
  }
  return [...groups.entries()].sort((a, b) => Number.parseInt(a[0], 10) - Number.parseInt(b[0], 10));
}

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
  const cards = settings.memoryCardSelections != null
    ? groups.cards.filter((product) =>
        new Set(Object.values(settings.memoryCardSelections ?? {})).has(product.id),
      )
    : settings.memoryCardProductIds === null
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

export function resolveCameraIpQuoteDefaults<T extends ProductLike>(
  products: T[],
  settings: CameraIpQuotePrefs,
): CameraIpQuoteDefaults<T> {
  const safe = settings ?? {};
  const configured = (
    map: Record<string, string>,
    key: string,
    legacySku: string,
  ) => byId(products, map[key]) ?? bySku(products, legacySku);

  return {
    cameras: Object.fromEntries(
      CAMERA_IP_QUOTE_CAMERA_TYPES.map((key) => [
        key,
        configured(safe.cameraProductIds ?? {}, key, CAMERA_IP_QUOTE_LEGACY_SKUS.camera[key]),
      ]),
    ) as Record<CameraIpQuoteCameraType, T | undefined>,
    recorders: Object.fromEntries(
      Object.entries(CAMERA_IP_QUOTE_LEGACY_SKUS.recorder).map(([key, sku]) => [
        key,
        configured(safe.recorderProductIds ?? {}, key, sku),
      ]),
    ) as Record<string, T | undefined>,
    switches: Object.fromEntries(
      Object.entries(CAMERA_IP_QUOTE_LEGACY_SKUS.switch).map(([key, sku]) => [
        key,
        configured(safe.switchProductIds ?? {}, key, sku),
      ]),
    ) as Record<string, T | undefined>,
    storage: Object.fromEntries(
      CAMERA_IP_QUOTE_STORAGE_SIZES.map((key) => [
        key,
        configured(safe.storageProductIds ?? {}, key, CAMERA_IP_QUOTE_LEGACY_SKUS.storage[key]),
      ]),
    ) as Record<string, T | undefined>,
    material: byId(products, safe.materialProductId) ?? bySku(products, CAMERA_IP_QUOTE_LEGACY_SKUS.material),
    installation: byId(products, safe.installationProductId) ?? bySku(products, CAMERA_IP_QUOTE_LEGACY_SKUS.installation),
    cable: byId(products, safe.cableProductId) ?? bySku(products, CAMERA_IP_QUOTE_LEGACY_SKUS.cable),
    ups: byId(products, safe.upsProductId) ?? bySku(products, CAMERA_IP_QUOTE_LEGACY_SKUS.ups),
    rack: byId(products, safe.rackProductId) ?? bySku(products, CAMERA_IP_QUOTE_LEGACY_SKUS.rack),
    monitor: byId(products, safe.monitorProductId) ?? bySku(products, CAMERA_IP_QUOTE_LEGACY_SKUS.monitor),
    surge: byId(products, safe.surgeProductId) ?? bySku(products, CAMERA_IP_QUOTE_LEGACY_SKUS.surge),
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
