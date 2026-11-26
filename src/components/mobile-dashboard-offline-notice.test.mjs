import { readSource } from "../test-support/read-source.mjs";
import { expect, test } from "bun:test";
const notice=readSource("./mobile-dashboard-offline-notice.tsx", import.meta.url);
const page=readSource("../app/(app)/dashboard/page.tsx", import.meta.url);
test("offline notice mirrors the native warning without duplicating dashboard data requests",()=>{
  expect(notice).toContain('window.addEventListener("offline"');
  expect(notice).toContain('window.addEventListener("online"');
  expect(notice).toContain('window.removeEventListener("offline"');
  expect(notice).toContain('if (!offline) return null');
  expect(notice).not.toContain("fetch(");
  expect(page).toContain("<MobileDashboardOfflineNotice />");
  expect(page.match(/await getDashboard\(/g)?.length).toBe(1);
});
