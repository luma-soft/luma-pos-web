import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { projectScheduleState } from "./schedule";

describe("projectScheduleState", () => {
  test("rejects a target date before the start date", () => {
    assert.deepEqual(projectScheduleState({
      startsOn: "2026-09-10",
      targetEndsOn: "2026-09-09",
      completed: false,
      today: "2026-09-08",
    }), { orderInvalid: true, targetInPast: false });
  });

  test("warns for a past target without completing automatically", () => {
    assert.deepEqual(projectScheduleState({
      targetEndsOn: "2026-09-07",
      completed: false,
      today: "2026-09-08",
    }), { orderInvalid: false, targetInPast: true });
  });

  test("does not warn for today or an already completed project", () => {
    assert.equal(projectScheduleState({
      targetEndsOn: "2026-09-08",
      completed: false,
      today: "2026-09-08",
    }).targetInPast, false);
    assert.equal(projectScheduleState({
      targetEndsOn: "2026-09-07",
      completed: true,
      today: "2026-09-08",
    }).targetInPast, false);
  });
});
