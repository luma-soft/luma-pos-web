import { describe, expect, it } from "vitest";
import {
  canTransitionWarrantyClaim,
  canTransitionServiceJob,
  createDefaultChecklist,
  isServiceTypeAllowedForProject,
} from "@/lib/services/domain";
import {
  installedAssetCreateSchema,
  serviceJobCreateSchema,
  serviceJobUpdateSchema,
  serviceProjectCreateSchema,
  warrantyClaimCreateSchema,
} from "@/lib/services/schemas";

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
    }).success).toBe(true);
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

  it("requires a warranty case to identify its project and issue", () => {
    expect(warrantyClaimCreateSchema.safeParse({
      projectId: "11111111-1111-4111-8111-111111111111",
      title: "Camera mất tín hiệu",
    }).success).toBe(true);
    expect(warrantyClaimCreateSchema.safeParse({ title: "Camera mất tín hiệu" }).success).toBe(false);
  });

  it("allows a resolved warranty case to close but not a new case", () => {
    expect(canTransitionWarrantyClaim("resolved", "closed")).toBe(true);
    expect(canTransitionWarrantyClaim("new", "closed")).toBe(false);
  });
});
