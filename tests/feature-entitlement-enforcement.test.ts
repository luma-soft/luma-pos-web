import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  NEW_STORE_FEATURE_DEFAULTS,
  resolveStoreFeatures,
  storeFeatureEnabled,
} from "@/lib/tenancy/store-features";

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

describe("feature entitlement enforcement", () => {
  test("new stores deny optional features and unknown keys", () => {
    const features = resolveStoreFeatures([]);
    expect(features).toEqual(NEW_STORE_FEATURE_DEFAULTS);
    expect(storeFeatureEnabled(features, "camera_quote_builder")).toBeFalse();
    expect(storeFeatureEnabled(features, "unknown_feature")).toBeFalse();
  });

  test("direct mobile APIs use feature-aware gates", () => {
    expect(read("src/app/api/mobile/quotes/camera-options/route.ts")).toContain("camera_quote_builder");
    expect(read("src/app/api/mobile/ai/assistant/route.ts")).toContain("requireMobileAiUser");
    expect(read("src/app/api/mobile/invoices/[id]/einvoice/route.ts")).toContain("requireMobileEinvoiceManager");
    expect(read("src/app/api/mobile/services/jobs/route.ts")).toContain("requireMobileServiceAccess");
  });

  test("workers and public surfaces fail closed by store entitlement", () => {
    expect(read("src/lib/einvoice/worker.ts")).toContain("storeFeatures.featureKey, \"einvoice\"");
    expect(read("src/lib/services/maintenance-worker.ts")).toContain("storeFeatures.featureKey, \"field_services\"");
    expect(read("src/lib/tenancy/public-store.ts")).toContain("eq(storeFeatures.enabled, true)");
    expect(read("src/app/camera-quote/page.tsx")).toContain("resolveLegacyCurrentPublicStore");
    expect(read("src/app/s/[storeSlug]/camera-quote/page.tsx")).toContain("resolvePublicStoreBySlug");
  });

  test("ordinary quotation routes remain independent of camera entitlement", () => {
    expect(read("src/app/(app)/quotes/page.tsx")).not.toContain("camera_quote_builder");
    expect(read("src/lib/orders/create.ts")).not.toContain("camera_quote_builder");
    expect(read("src/lib/orders/convert.ts")).not.toContain("camera_quote_builder");
  });
});
