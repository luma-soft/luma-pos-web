import assert from "node:assert/strict";
import test from "node:test";
import { serviceProjectCreateSchema } from "./schemas";

const baseProject = {
  name: "Công trình camera",
  serviceType: "camera" as const,
};

test("service project defaults to active and accepts explicit completion", () => {
  assert.equal(serviceProjectCreateSchema.parse(baseProject).status, "active");

  const completed = serviceProjectCreateSchema.parse({
    ...baseProject,
    status: "done",
  });
  assert.equal(completed.status, "done");
});

test("service project schedule cannot end before it starts", () => {
  assert.equal(serviceProjectCreateSchema.safeParse({
    ...baseProject,
    startsOn: "2026-09-10",
    targetEndsOn: "2026-09-09",
  }).success, false);

  assert.equal(serviceProjectCreateSchema.safeParse({
    ...baseProject,
    startsOn: "2026-09-10",
    targetEndsOn: "2026-09-10",
  }).success, true);
});
