import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

import { createMobileAuthMock } from "./helpers/mobile-auth-mock";

afterAll(() => mock.restore());

const deletedProjectIds: string[] = [];

mock.module("@/lib/mobile/auth", () => createMobileAuthMock({
  requireMobileUser: async () => ({
    ok: true,
    storeId: "store-1",
    userId: "owner-1",
    role: "owner",
    features: { field_services: true },
  }),
  requireMobileManager: async () => ({
    ok: true,
    storeId: "store-1",
    userId: "owner-1",
    role: "owner",
    features: { field_services: true },
  }),
}));

mock.module("@/lib/actions/extras", () => ({
  deleteProject: async (id: string) => {
    deletedProjectIds.push(id);
    return { ok: true, data: undefined };
  },
  updateProject: async () => ({ ok: true, data: undefined }),
}));

mock.module("@/lib/data/projects", () => ({
  getProjectDetail: async () => null,
}));

mock.module("@/lib/data/services", () => ({
  getServiceFormOptions: async () => ({}),
}));

mock.module("@/lib/tenancy/store-features", () => ({
  storeFeatureEnabled: () => true,
}));

type RouteContext = { params: Promise<{ id: string }> };
let deleteProjectRoute: (
  request: Request,
  context: RouteContext,
) => Promise<Response>;

beforeAll(async () => {
  const route = await import("../src/app/api/mobile/projects/[id]/route");
  deleteProjectRoute = route.DELETE;
});

describe("mobile project deletion route", () => {
  test("requires manager access and delegates the exact project id", async () => {
    const response = await deleteProjectRoute(
      new Request("https://luma.test/api/mobile/projects/project-1", {
        method: "DELETE",
      }),
      { params: Promise.resolve({ id: "project-1" }) },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(deletedProjectIds).toEqual(["project-1"]);
  });
});
