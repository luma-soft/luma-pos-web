import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { createMobileAuthMock } from "./helpers/mobile-auth-mock";

afterAll(() => mock.restore());

const completedIds: string[] = [];

mock.module("@/lib/mobile/auth", () => createMobileAuthMock({
  requireMobileServiceManager: async () => ({
    ok: true,
    storeId: "store-1",
    userId: "manager-1",
    role: "manager",
    features: { field_services: true },
  }),
}));

mock.module("@/lib/actions/extras", () => ({
  completeServiceProjectManually: async ({ id }: { id: string }) => {
    completedIds.push(id);
    return { ok: true, data: undefined };
  },
}));

let postManualCompletion: (
  request: Request,
  context: { params: Promise<{ id: string }> },
) => Promise<Response>;

beforeAll(async () => {
  ({ POST: postManualCompletion } = await import(
    "../src/app/api/mobile/projects/[id]/complete-manually/route"
  ));
});

describe("POST /api/mobile/projects/:id/complete-manually", () => {
  test("forwards the exact service project id to the manager override", async () => {
    const response = await postManualCompletion(
      new Request("https://luma.test/api/mobile/projects/project-1/complete-manually", {
        method: "POST",
      }),
      { params: Promise.resolve({ id: "project-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(completedIds).toEqual(["project-1"]);
  });

  test("override updates only project state and records the bypass audit", () => {
    const source = readFileSync("src/lib/actions/extras.ts", "utf8");
    const start = source.indexOf("export async function completeServiceProjectManually");
    const nextExport = source.indexOf("\nexport async function", start + 1);
    const implementation = source.slice(
      start,
      nextExport < 0 ? source.length : nextExport,
    );

    expect(start).toBeGreaterThan(-1);
    expect(implementation).toContain("status: \"done\"");
    expect(implementation).toContain("serviceStage: \"completed\"");
    expect(implementation).toContain("progressPercent: 100");
    expect(implementation).toContain("service_project.manual_complete");
    expect(implementation).toContain("bypassedCloseRequirements: true");
    expect(implementation).toContain("childJobsMutated: false");
    expect(implementation).not.toContain("db.update(serviceJobs)");
  });
});
