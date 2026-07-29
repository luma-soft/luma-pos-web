import { expect, test } from "bun:test";
import vercelConfig from "../vercel.json";

test("deployment invokes bounded notification outbox recovery every minute", () => {
  expect(vercelConfig.crons).toContainEqual({
    path: "/api/cron/notifications/outbox",
    schedule: "* * * * *",
  });
});
