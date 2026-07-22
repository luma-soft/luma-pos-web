import { describe, expect, it } from "vitest";
import {
  canTransitionWarrantyClaim,
  canTransitionServiceJob,
  calculateServiceMaterialStockSync,
  calculateServiceProjectProfitability,
  createDefaultChecklist,
  isServiceTypeAllowedForProject,
  validateServiceLinks,
} from "@/lib/services/domain";
import {
  installedAssetCreateSchema,
  installedAssetUpdateSchema,
  serviceJobCreateSchema,
  serviceJobUpdateSchema,
  serviceProjectCreateSchema,
  warrantyClaimCreateSchema,
  warrantyClaimUpdateSchema,
} from "@/lib/services/schemas";
import { Routes } from "@/lib/routes";

describe("service project checklists", () => {
  it("creates a camera checklist that covers survey through handover", () => {
    expect(createDefaultChecklist("camera").map((item) => item.code)).toEqual([
      "site-survey",
      "cabling",
      "device-installation",
      "configuration",
      "commissioning",
      "handover",
    ]);
  });

  it("creates an electrical checklist with safety and measurement steps", () => {
    expect(createDefaultChecklist("electrical").map((item) => item.code)).toEqual([
      "electrical-survey",
      "isolation",
      "cabling-and-panel",
      "fixture-installation",
      "electrical-testing",
      "handover",
    ]);
  });

  it("creates a plumbing checklist with pressure and leak tests", () => {
    expect(createDefaultChecklist("plumbing").map((item) => item.code)).toEqual([
      "plumbing-survey",
      "water-isolation",
      "pipework",
      "fixture-installation",
      "pressure-and-leak-test",
      "handover",
    ]);
  });
});

describe("service job status", () => {
  it("allows field work to start but prevents an unstarted job from completing", () => {
    expect(canTransitionServiceJob("scheduled", "in_progress")).toBe(true);
    expect(canTransitionServiceJob("new", "completed")).toBe(false);
  });
});

describe("service job input", () => {
  it("requires every field job to belong to one concrete trade", () => {
    const base = {
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "Thi công tầng trệt",
    };

    expect(serviceJobCreateSchema.safeParse({ ...base, serviceType: "camera" }).success).toBe(true);
    expect(serviceJobCreateSchema.safeParse({ ...base, serviceType: "mixed" }).success).toBe(false);
  });

  it("validates editable scheduling and assignment fields", () => {
    expect(serviceJobUpdateSchema.safeParse({
      jobId: "b3a15e84-7e3f-4e7f-b516-f5b72ca4b72c",
      serviceType: "electrical",
      title: "Kiểm tra tủ điện",
      priority: "high",
      assignedTo: null,
      scheduledAt: "2026-07-22T02:30:00.000Z",
      description: "Đo tải và kiểm tra tiếp địa",
      quoteOrderId: "cf3dbf89-6b79-441c-b4cd-934ce25fdf80",
      materialOrderId: null,
    }).success).toBe(true);
  });
});

describe("service project profitability", () => {
  it("calculates total cost, gross profit, and margin", () => {
    const result = calculateServiceProjectProfitability({
      revenue: 10000000,
      materialCost: 4000000,
      laborCost: 2000000,
      otherCost: 500000,
    });
    expect(result).toEqual({
      revenue: 10000000,
      materialCost: 4000000,
      laborCost: 2000000,
      otherCost: 500000,
      totalCost: 6500000,
      grossProfit: 3500000,
      marginPercent: 35,
    });
  });

  it("rejects negative or non-finite cost inputs", () => {
    expect(calculateServiceProjectProfitability({ revenue: 10, materialCost: -1, laborCost: 0, otherCost: 0 })).toBeNull();
    expect(calculateServiceProjectProfitability({ revenue: Number.NaN, materialCost: 0, laborCost: 0, otherCost: 0 })).toBeNull();
  });
});

describe("service project input", () => {
  it("allows a mixed project while requiring a named customer site", () => {
    const parsed = serviceProjectCreateSchema.safeParse({
      name: "Nhà phố An Phú",
      serviceType: "mixed",
      address: "12 Nguyễn Hoàng, TP Thủ Đức",
    });

    expect(parsed.success).toBe(true);
    expect(serviceProjectCreateSchema.safeParse({ serviceType: "camera" }).success).toBe(false);
  });

  it("keeps a single-trade project focused while mixed projects accept every trade", () => {
    expect(isServiceTypeAllowedForProject("camera", "camera")).toBe(true);
    expect(isServiceTypeAllowedForProject("camera", "plumbing")).toBe(false);
    expect(isServiceTypeAllowedForProject("mixed", "plumbing")).toBe(true);
  });
});

describe("installed assets and warranty", () => {
  it("supports both serialized camera equipment and non-serialized plumbing fixtures", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    expect(installedAssetCreateSchema.safeParse({
      projectId,
      assetKind: "camera",
      name: "Camera cổng chính",
      serialNumber: "CAM-001",
      macAddress: "AA:BB:CC:DD:EE:FF",
    }).success).toBe(true);
    expect(installedAssetCreateSchema.safeParse({
      projectId,
      assetKind: "valve",
      name: "Van tổng tầng 1",
    }).success).toBe(true);
  });

  it("tracks installed asset lifecycle and warranty dates", () => {
    expect(installedAssetUpdateSchema.safeParse({
      assetId: "5cc4c05b-2e33-4719-81cf-748d4c97813e",
      jobId: null,
      productId: null,
      assetKind: "breaker",
      name: "CB tổng",
      status: "repair",
      installedAt: "2026-07-22T02:30:00.000Z",
      customerWarrantyEndsOn: "2027-07-22",
      supplierWarrantyEndsOn: "2028-07-22",
    }).success).toBe(true);
  });

  it("requires a warranty case to identify its project and issue", () => {
    expect(warrantyClaimCreateSchema.safeParse({
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "Camera mất tín hiệu",
    }).success).toBe(true);
    expect(warrantyClaimCreateSchema.safeParse({ title: "Camera mất tín hiệu" }).success).toBe(false);
  });

  it("validates warranty scheduling and service charges", () => {
    expect(warrantyClaimUpdateSchema.safeParse({
      claimId: "d5a84a82-d4c0-4b8f-b20d-87501d14a727",
      jobId: null,
      assetId: null,
      title: "Camera mất tín hiệu",
      priority: "urgent",
      scheduledAt: "2026-07-22T02:30:00.000Z",
      laborCharge: 250000,
      materialCharge: 150000,
    }).success).toBe(true);
  });

  it("allows a resolved warranty case to close but not a new case", () => {
    expect(canTransitionWarrantyClaim("resolved", "closed")).toBe(true);
    expect(canTransitionWarrantyClaim("new", "closed")).toBe(false);
  });
});

describe("service quote links", () => {
  it("prefills the existing POS quote flow with project and customer context", () => {
    const href = Routes.projectQuote({
      projectId: "d5a84a82-d4c0-4b8f-b20d-87501d14a727",
      projectName: "Camera kho Bình Tân",
      customerId: "cf3dbf89-6b79-441c-b4cd-934ce25fdf80",
    });
    expect(href).toContain("/pos?draft=quote");
    expect(href).toContain("projectName=Camera+kho+B%C3%ACnh+T%C3%A2n");
    expect(href).toContain("customerId=cf3dbf89-6b79-441c-b4cd-934ce25fdf80");
  });

  it("rejects orders and field records linked to a different project", () => {
    const projectId = "d5a84a82-d4c0-4b8f-b20d-87501d14a727";
    const otherProjectId = "cf3dbf89-6b79-441c-b4cd-934ce25fdf80";

    expect(validateServiceLinks({
      projectId,
      job: { projectId },
      asset: { projectId },
      quoteOrder: { projectId, status: "quote" },
      materialOrder: { projectId, status: "confirmed" },
    })).toBe(true);
    expect(validateServiceLinks({ projectId, job: { projectId: otherProjectId } })).toBe(false);
    expect(validateServiceLinks({ projectId, asset: null })).toBe(false);
    expect(validateServiceLinks({ projectId, quoteOrder: { projectId, status: "confirmed" } })).toBe(false);
    expect(validateServiceLinks({ projectId, materialOrder: { projectId, status: "cancelled" } })).toBe(false);
  });
});

describe("service material stock sync", () => {
  it("calculates base-unit issues and returns from the posted difference", () => {
    expect(calculateServiceMaterialStockSync(3, 4, 8)).toEqual({
      targetBaseQuantity: 12,
      deltaBaseQuantity: 4,
    });
    expect(calculateServiceMaterialStockSync(1, 4, 12)).toEqual({
      targetBaseQuantity: 4,
      deltaBaseQuantity: -8,
    });
  });

  it("rejects invalid usage and unit multipliers", () => {
    expect(calculateServiceMaterialStockSync(-1, 1, 0)).toBeNull();
    expect(calculateServiceMaterialStockSync(1, 0, 0)).toBeNull();
  });
});
