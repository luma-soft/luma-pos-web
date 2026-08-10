export const STORE_FEATURE_KEYS = [
  "camera_quote_builder",
  "camera_price_list",
  "hunonic_price_list",
  "rang_dong_price_list",
  "field_services",
  "online_sales",
  "ai_assistant",
  "einvoice",
] as const;

export type StoreFeatureKey = (typeof STORE_FEATURE_KEYS)[number];
export type StoreFeatureSet = Record<StoreFeatureKey, boolean>;

export const NEW_STORE_FEATURE_DEFAULTS: StoreFeatureSet = {
  camera_quote_builder: false,
  camera_price_list: false,
  hunonic_price_list: false,
  rang_dong_price_list: false,
  field_services: false,
  online_sales: false,
  ai_assistant: false,
  einvoice: false,
};

export const CURRENT_STORE_FEATURE_DEFAULTS: StoreFeatureSet = Object.fromEntries(
  STORE_FEATURE_KEYS.map((key) => [key, true]),
) as StoreFeatureSet;

const STORE_FEATURE_KEY_SET = new Set<string>(STORE_FEATURE_KEYS);

export function isStoreFeatureKey(value: string): value is StoreFeatureKey {
  return STORE_FEATURE_KEY_SET.has(value);
}

export function resolveStoreFeatures(
  rows: ReadonlyArray<{ featureKey: string; enabled: boolean }>,
  defaults: StoreFeatureSet = NEW_STORE_FEATURE_DEFAULTS,
): StoreFeatureSet {
  const resolved = { ...defaults };
  for (const row of rows) {
    if (isStoreFeatureKey(row.featureKey)) {
      resolved[row.featureKey] = row.enabled;
    }
  }
  return resolved;
}

export function storeFeatureEnabled(
  features: StoreFeatureSet,
  featureKey: string,
  deploymentEnabled = true,
): boolean {
  return deploymentEnabled
    && isStoreFeatureKey(featureKey)
    && features[featureKey] === true;
}
