import { describe, expect, test } from "bun:test";
import { serviceSnapshotMutationErrorKey } from "@/lib/services/field-api";

describe("service snapshot mutation error mapping", () => {
  test("maps direct and wrapped completed-snapshot locks to the manager business key", () => {
    const direct = new Error("SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED");
    const wrapped = new Error("Failed query: update service_jobs", {
      cause: direct,
    });

    expect(serviceSnapshotMutationErrorKey(direct)).toBe(
      "services.errors.signedSnapshotLocked",
    );
    expect(serviceSnapshotMutationErrorKey(wrapped)).toBe(
      "services.errors.signedSnapshotLocked",
    );
    expect(serviceSnapshotMutationErrorKey(new Error("other"))).toBe(
      "errors.serverError",
    );
  });
});
