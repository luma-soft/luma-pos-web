import { describe, expect, it } from "vitest";
import { validateOfflineReplayActor } from "@/lib/mobile/offline-actor";

describe("offline replay actor binding", () => {
  it("rejects a queued mutation when the authenticated effective actor changed", () => {
    expect(
      validateOfflineReplayActor({
        header: "principal-1:cashier-a",
        principalId: "principal-1",
        actorId: "cashier-b",
      })
    ).toBe(false);

    expect(
      validateOfflineReplayActor({
        header: "principal-1:cashier-a",
        principalId: "principal-1",
        actorId: "cashier-a",
      })
    ).toBe(true);
  });
});
