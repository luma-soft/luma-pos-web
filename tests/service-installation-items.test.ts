import { describe, expect, it } from "bun:test";
import { inferServiceItemTracking } from "../src/lib/services/installation-item-classification";
import { serviceInstallationBatchSchema } from "../src/lib/services/schemas";

const ids = {
  project: "00000000-0000-4000-8000-000000000001",
  job: "00000000-0000-4000-8000-000000000002",
  product: "00000000-0000-4000-8000-000000000003",
  warehouse: "00000000-0000-4000-8000-000000000004",
  order: "00000000-0000-4000-8000-000000000005",
};

function validInput() {
  return {
    projectId: ids.project,
    jobId: ids.job,
    requestId: "install-request-1",
    stockMode: "plan" as const,
    invoiceMode: "none" as const,
    items: [{
      clientDraftId: "camera-1",
      productId: ids.product,
      unitName: "cái",
      quantity: 2,
      tracking: "asset" as const,
      serialNumbers: ["CAM-001", "CAM-002"],
    }],
  };
}

describe("unified service installation contract", () => {
  it("infers common cable and measured units as consumables", () => {
    expect(inferServiceItemTracking({ name: "Dây mạng CAT6", baseUnit: "m" })).toBe("consumable");
    expect(inferServiceItemTracking({ name: "Camera IP", baseUnit: "cái" })).toBe("asset");
  });

  it("accepts tracked assets with serials", () => {
    expect(serviceInstallationBatchSchema.safeParse(validInput()).success).toBe(true);
  });

  it("requires a warehouse for reserve and issue modes", () => {
    const parsed = serviceInstallationBatchSchema.safeParse({
      ...validInput(),
      stockMode: "issue",
    });
    expect(parsed.success).toBe(false);
  });

  it("prevents stock being processed twice when an invoice owns stock", () => {
    const parsed = serviceInstallationBatchSchema.safeParse({
      ...validInput(),
      stockMode: "issue",
      warehouseId: ids.warehouse,
      invoiceMode: "link",
      materialOrderId: ids.order,
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects fractional tracked assets and extra serials", () => {
    const parsed = serviceInstallationBatchSchema.safeParse({
      ...validInput(),
      items: [{
        ...validInput().items[0],
        quantity: 1.5,
        serialNumbers: ["A", "B"],
      }],
    });
    expect(parsed.success).toBe(false);
  });
});
