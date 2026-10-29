import { mock, test, expect } from "bun:test";

let authorized = true;
const writes = [];

const transaction = mock(async (run) => run({
  update(table) {
    return {
      set(values) {
        return {
          where(condition) {
            writes.push({ kind: "update", table, values, condition });
            return Promise.resolve();
          },
        };
      },
    };
  },
  insert(table) {
    return {
      values(values) {
        return {
          onConflictDoUpdate(conflict) {
            writes.push({ kind: "insert", table, values, conflict });
            return Promise.resolve();
          },
        };
      },
    };
  },
}));

mock.module("@/db", () => ({ db: { transaction } }));
mock.module("@/lib/actions/common", () => ({
  getProfileId: async () => "profile-1",
}));
mock.module("@/lib/mobile/auth", () => ({
  requireMobileUser: async () => authorized
    ? { ok: true, userId: "user-1", storeId: "store-1", role: "owner" }
    : { ok: false, error: "errors.unauthorized" },
}));
mock.module("@/lib/mobile/response", () => ({
  mobileGate: (gate) => gate.ok
    ? null
    : Response.json({ ok: false, error: gate.error }, { status: 401 }),
  mobileOk: (data) => Response.json({ ok: true, data }),
  mobileError: (error, status = 400) => Response.json({ ok: false, error }, { status }),
  readJson: async (request) => {
    try { return await request.json(); } catch { return null; }
  },
}));

const [{ POST }, { mobileNotificationStates, notificationRecipients }] = await Promise.all([
  import("./route.ts"),
  import("@/db/schema"),
]);

test("marks all unread persisted events plus visible legacy rows for the signed-in user", async () => {
  writes.length = 0;
  authorized = true;
  const returnedPersistedIds = Array.from({ length: 50 }, (_, index) =>
    `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
  );

  const response = await POST(new Request("http://localhost/api/mobile/notifications/read-all", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      ids: [
        ...returnedPersistedIds,
        "warranty-claim-1",
        "restock-product-2",
        "unsafe id",
      ],
    }),
  }));

  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true, data: { applied: true } });
  expect(writes).toHaveLength(2);
  expect(writes[0]).toMatchObject({
    kind: "update",
    table: notificationRecipients,
    values: { readAt: expect.any(Date) },
  });
  expect(writes[1]).toMatchObject({
    kind: "insert",
    table: mobileNotificationStates,
    values: [
      {
        storeId: "store-1",
        userId: "profile-1",
        notificationId: "warranty-claim-1",
        read: true,
        dismissed: false,
      },
      {
        storeId: "store-1",
        userId: "profile-1",
        notificationId: "restock-product-2",
        read: true,
        dismissed: false,
      },
    ],
  });
});

test("does not mutate notifications without authentication", async () => {
  writes.length = 0;
  authorized = false;

  const response = await POST(new Request("http://localhost/api/mobile/notifications/read-all", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: ["warranty-claim-1"] }),
  }));

  expect(response.status).toBe(401);
  expect(writes).toHaveLength(0);
});
