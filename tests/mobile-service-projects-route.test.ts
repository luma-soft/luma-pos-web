import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createMobileAuthMock } from "./helpers/mobile-auth-mock";

afterAll(() => mock.restore());

const queries: Array<Record<string, unknown>> = [];

mock.module("@/lib/mobile/auth", () => createMobileAuthMock({
  requireMobileServiceAccess: async () => ({ ok: true, storeId: "store-1" }),
  requireMobileServiceManager: async () => ({ ok: true, storeId: "store-1" }),
}));

mock.module("@/lib/actions/services", () => ({
  createServiceProject: async () => ({ ok: true, data: { id: "project-new" } }),
}));

mock.module("@/lib/data/services", () => ({
  getServiceDashboard: async () => ({
    projects: [{ id: "legacy-project", name: "Legacy" }],
  }),
  getServiceProjectsPage: async (_storeId: string, query: Record<string, unknown>) => {
    queries.push(query);
    return {
      rows: [{ id: "project-1", name: "Camera Alpha" }],
      total: 41,
      page: 2,
      pageSize: 20,
      pageCount: 3,
      summary: { attention: 4, overdue: 2 },
    };
  },
}));

let getProjects: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ GET: getProjects } = await import(
    "../src/app/api/mobile/services/projects/route"
  ));
});

beforeEach(() => queries.splice(0));

describe("GET /api/mobile/services/projects", () => {
  test("forwards search, status, service type, and pagination", async () => {
    const response = await getProjects(
      new Request(
        "https://luma.test/api/mobile/services/projects?q=alpha&status=active&serviceType=camera&urgency=overdue&page=2&pageSize=20",
      ),
    );

    expect(response.status).toBe(200);
    expect(queries).toEqual([{
      q: "alpha",
      status: "active",
      serviceType: "camera",
      urgency: "overdue",
      page: 2,
      pageSize: 20,
    }]);
  });

  test("returns pagination metadata and project attention summary", async () => {
    const response = await getProjects(
      new Request("https://luma.test/api/mobile/services/projects"),
    );
    const payload = await response.json();

    expect(payload.data).toEqual({
      rows: [{ id: "project-1", name: "Camera Alpha" }],
      total: 41,
      page: 2,
      pageSize: 20,
      pageCount: 3,
      summary: { attention: 4, overdue: 2 },
    });
  });
});
