import assert from "node:assert/strict";
import test from "node:test";

import { deriveReopenedServiceProjectState } from "./status";

test("reopening recalculates progress from non-cancelled jobs", () => {
  assert.deepEqual(deriveReopenedServiceProjectState({
    jobStatuses: ["completed", "in_progress", "cancelled"],
    warrantyClaimStatuses: [],
  }), {
    progressPercent: 50,
    serviceStage: "active",
  });
});

test("reopening without jobs starts at zero progress", () => {
  assert.deepEqual(deriveReopenedServiceProjectState({
    jobStatuses: [],
    warrantyClaimStatuses: [],
  }), {
    progressPercent: 0,
    serviceStage: "active",
  });
});

test("reopening keeps warranty stage when a warranty claim is open", () => {
  assert.deepEqual(deriveReopenedServiceProjectState({
    jobStatuses: ["completed"],
    warrantyClaimStatuses: ["resolved"],
  }), {
    progressPercent: 100,
    serviceStage: "warranty",
  });
});

test("reopening preserves a completed operational stage when every job is done", () => {
  assert.deepEqual(deriveReopenedServiceProjectState({
    jobStatuses: ["completed", "completed"],
    warrantyClaimStatuses: [],
  }), {
    progressPercent: 100,
    serviceStage: "completed",
  });
});
