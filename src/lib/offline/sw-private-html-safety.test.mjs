import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
const sw = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../../../public/offline.html", import.meta.url), "utf8");

test("SW never caches authenticated HTML, RSC or API responses", () => {
  expect(sw).toContain('const CACHE = "lumapos-static-v7"');
  expect(sw).toContain('if (req.mode === "navigate")');
  expect(sw).toContain("fetch(req).catch");
  expect(sw).not.toContain('url.pathname !== "/pos"');
  expect(sw).not.toContain("c.put(req, copy)");
  expect(sw).toContain("startsWith(\"/_next/static/\")");
});
test("offline fallback is a public recovery page", () => {
  expect(html).toContain("Không có kết nối mạng");
  expect(html).toContain('href="/pos"');
  expect(html).not.toContain("supabase");
  expect(html).not.toContain("customerId");
});
