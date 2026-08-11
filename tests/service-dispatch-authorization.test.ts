import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";

afterAll(() => mock.restore());

let queryCalls = 0;

mock.module("@/app/api/mobile/services/manager-dependencies", () => ({
  requireMobileServiceManager: async () => ({ ok: false, error: "errors.forbidden" }),
  parseServiceDispatchQuery: () => {
    queryCalls += 1;
    return {};
  },
  parseServiceReportQuery: () => {
    queryCalls += 1;
    return {};
  },
  getServiceDispatchPage: async () => ({ rows: [] }),
  getServiceManagerReport: async () => ({ rows: [] }),
}));

let dispatchGet: (request: Request) => Promise<Response>;
let reportGet: (request: Request) => Promise<Response>;

beforeAll(async () => {
  ({ GET: dispatchGet } = await import(
    "../src/app/api/mobile/services/dispatch/route"
  ));
  ({ GET: reportGet } = await import(
    "../src/app/api/mobile/services/reports/route"
  ));
});

describe("service manager endpoints", () => {
  test("reject technicians before dispatch query execution", async () => {
    queryCalls = 0;
    const response = await dispatchGet(new Request("http://localhost/api/mobile/services/dispatch"));
    expect(response.status).toBe(403);
    expect(queryCalls).toBe(0);
  });

  test("reject technicians before report query execution", async () => {
    queryCalls = 0;
    const response = await reportGet(new Request("http://localhost/api/mobile/services/reports"));
    expect(response.status).toBe(403);
    expect(queryCalls).toBe(0);
  });
});
