import { expect, test } from "bun:test";
import vercelConfig from "../vercel.json";

test("Hobby deployment invokes bounded notification outbox recovery once daily", () => {
  expect(vercelConfig.crons).toContainEqual({
    path: "/api/cron/notifications/outbox",
    schedule: "0 0 * * *",
  });
});
