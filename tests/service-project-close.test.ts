import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { evaluateServiceProjectClose } from "@/lib/services/project-close";
import { serviceCoordinationUpdateSchema } from "@/lib/services/project-specialized-schemas";

const root = process.cwd();

describe("service project close guard", () => {
  test("single-trade projects require terminal jobs and a signed handover", () => {
    expect(evaluateServiceProjectClose({
      serviceType: "camera",
      jobStatuses: ["completed", "cancelled"],
      handoverDocuments: [{ type: "handover", status: "signed" }],
      dependencies: [{ status: "blocked" }],
      coordinationPoints: [{ status: "blocked", isAcceptanceRequired: true }],
    })).toEqual({
      canClose: true,
      incompleteJobs: 0,
      coordinationBlockers: 0,
      handoverSigned: true,
    });

    expect(evaluateServiceProjectClose({
      serviceType: "plumbing",
      jobStatuses: ["in_progress"],
      handoverDocuments: [{ type: "handover", status: "draft" }],
      dependencies: [],
      coordinationPoints: [],
    }).canClose).toBe(false);
  });

  test("mixed projects cannot close with required dependency or coordination blockers", () => {
    const state = evaluateServiceProjectClose({
      serviceType: "mixed",
      jobStatuses: ["completed", "completed"],
      handoverDocuments: [{ type: "handover", status: "signed" }],
      dependencies: [{ status: "blocked" }, { status: "waived" }],
      coordinationPoints: [
        { status: "open", isAcceptanceRequired: true },
        { status: "open", isAcceptanceRequired: false },
      ],
    });
    expect(state.canClose).toBe(false);
    expect(state.coordinationBlockers).toBe(2);
  });

  test("mobile service project listing uses field-service access and server close mutations use the shared guard", () => {
    const listRoute = readFileSync(
      join(root, "src/app/api/mobile/services/projects/route.ts"),
      "utf8",
    );
    const action = readFileSync(
      join(root, "src/lib/actions/extras.ts"),
      "utf8",
    );
    expect(listRoute).toContain("requireMobileServiceAccess()");
    expect(listRoute).not.toContain("requireMobileServiceSalesAccess()");
    expect(action).toContain("canCloseServiceProject");
    expect(action).toContain("services.errors.projectCloseBlocked");
  });

  test("mixed coordination updates share one validated manager endpoint", () => {
    const route = readFileSync(
      join(root, "src/app/api/mobile/services/projects/[id]/coordination/route.ts"),
      "utf8",
    );
    expect(serviceCoordinationUpdateSchema.safeParse({
      kind: "dependency",
      id: "530cbf7e-f09e-4d5f-b5fe-e95f16f030fa",
      status: "completed",
    }).success).toBe(true);
    expect(serviceCoordinationUpdateSchema.safeParse({
      kind: "point",
      id: "7a85dbe4-f8af-427c-9c03-9f2e12932c36",
      status: "resolved",
    }).success).toBe(true);
    expect(serviceCoordinationUpdateSchema.safeParse({
      kind: "point",
      id: "7a85dbe4-f8af-427c-9c03-9f2e12932c36",
      status: "completed",
    }).success).toBe(false);
    expect(route).toContain("export async function PATCH");
    expect(route).toContain("requireMobileServiceManager()");
    expect(route).toContain("serviceJobDependencies");
    expect(route).toContain("serviceCoordinationPoints");
  });
});
