import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const notice=readFileSync(new URL("./mobile-dashboard-offline-notice.tsx",import.meta.url),"utf8");
const page=readFileSync(new URL("../app/(app)/dashboard/page.tsx",import.meta.url),"utf8");
test("offline notice mirrors the native warning without duplicating dashboard data requests",()=>{
  expect(notice).toContain('window.addEventListener("offline"');
  expect(notice).toContain('window.addEventListener("online"');
  expect(notice).toContain('window.removeEventListener("offline"');
  expect(notice).toContain('if (!offline) return null');
  expect(notice).not.toContain("fetch(");
  expect(page).toContain("<MobileDashboardOfflineNotice />");
  expect(page.match(/await getDashboard\(/g)?.length).toBe(1);
});
