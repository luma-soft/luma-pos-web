import { describe, expect, test } from "bun:test";
import {
  CURRENT_STORE_FEATURE_DEFAULTS,
  NEW_STORE_FEATURE_DEFAULTS,
  STORE_FEATURE_KEYS,
  resolveStoreFeatures,
  storeFeatureEnabled,
} from "@/lib/tenancy/store-features";

describe("store feature registry", () => {
  test("defines the complete initial deny-by-default registry", () => {
    expect(STORE_FEATURE_KEYS).toEqual([
      "camera_quote_builder",
      "camera_price_list",
      "hunonic_price_list",
      "rang_dong_price_list",
      "field_services",
      "online_sales",
      "ai_assistant",
      "einvoice",
    ]);
    expect(NEW_STORE_FEATURE_DEFAULTS).toEqual({
      camera_quote_builder: false,
      camera_price_list: false,
      hunonic_price_list: false,
      rang_dong_price_list: false,
      field_services: false,
      online_sales: false,
      ai_assistant: false,
      einvoice: false,
    });
  });

  test("preserves every existing feature for the current store", () => {
    expect(Object.values(CURRENT_STORE_FEATURE_DEFAULTS).every(Boolean)).toBe(true);
  });

  test("unknown, missing, and deployment-disabled features fail closed", () => {
    const features = resolveStoreFeatures([
      { featureKey: "camera_quote_builder", enabled: true },
      { featureKey: "not_registered", enabled: true },
    ]);

    expect(storeFeatureEnabled(features, "camera_quote_builder")).toBe(true);
    expect(storeFeatureEnabled(features, "camera_price_list")).toBe(false);
    expect(storeFeatureEnabled(features, "not_registered")).toBe(false);
    expect(storeFeatureEnabled(features, "camera_quote_builder", false)).toBe(false);
  });
});
