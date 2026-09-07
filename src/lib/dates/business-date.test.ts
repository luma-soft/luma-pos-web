import assert from "node:assert/strict";
import test from "node:test";

import { businessDateKey, calendarDayDistance } from "./business-date";

test("business date rolls over at midnight in Ho Chi Minh City", () => {
  assert.equal(businessDateKey(new Date("2026-09-06T16:59:59Z")), "2026-09-06");
  assert.equal(businessDateKey(new Date("2026-09-06T17:00:00Z")), "2026-09-07");
});

test("calendar day distance is independent of runtime timezone", () => {
  assert.equal(calendarDayDistance("2026-09-06", "2026-09-07"), -1);
  assert.equal(calendarDayDistance("2026-09-07", "2026-09-07"), 0);
  assert.equal(calendarDayDistance("2026-09-08", "2026-09-07"), 1);
});
