import { describe, expect, it } from "bun:test";
import { internalUseReasonLabel } from "@/lib/inventory/internal-use-reason";

describe("internal-use reason labels", () => {
  it("translates mobile reason codes in both supported locales", () => {
    expect(internalUseReasonLabel("mobile_product_internal_use", "vi")).toBe(
      "Nhân viên sử dụng",
    );
    expect(internalUseReasonLabel("mobile_product_internal_use", "en")).toBe(
      "Staff use",
    );
  });

  it("preserves server-provided labels and handles empty values", () => {
    expect(internalUseReasonLabel("Vật tư văn phòng", "vi")).toBe(
      "Vật tư văn phòng",
    );
    expect(internalUseReasonLabel(null, "vi")).toBe("—");
  });
});
