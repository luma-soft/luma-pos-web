import { describe, expect, test } from "bun:test";
import { resolveNotificationChannels } from "../src/lib/notifications/channels";

describe("notification delivery channel registry", () => {
  test("advertises only implemented adapters and derives configuration", () => {
    expect(resolveNotificationChannels({})).toEqual([
      { id: "inApp", configured: true },
      { id: "push", configured: false },
    ]);

    expect(resolveNotificationChannels({
      FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        project_id: "luma",
        client_email: "firebase@luma.example",
        private_key: "private-key",
      }),
      ZALO_ACCESS_TOKEN: "must-not-enable-an-unimplemented-adapter",
    })).toEqual([
      { id: "inApp", configured: true },
      { id: "push", configured: true },
    ]);
  });
});
