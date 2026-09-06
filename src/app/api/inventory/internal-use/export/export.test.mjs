import { expect, mock, test } from "bun:test";
let allowed = true;
const rows = [{ code: "XNB01", createdAt: new Date("2026-09-06T00:00:00Z"), status: "approved", department: "Kỹ thuật", reason: "internal", note: "=formula", items: [{ sku: "SP01", productName: 'Vít, "nhỏ"', unitName: "KG", unitMultiplier: "1", quantity: "0.5001", unitCost: "10000", total: "5001" }] }];
const read = mock(async () => rows);
const count = mock(async () => 73);
mock.module("@/lib/actions/common", () => ({ requireStockAccess: async () => allowed ? { ok: true, storeId: "own-store" } : { ok: false, error: "errors.forbidden" } }));
mock.module("@/lib/data/internal-use", () => ({ getInternalUseIssues: read, getInternalUseIssueCount: count }));
const { GET } = await import("./route");
test("filtered export reads full authorized result and preserves fractional values", async () => {
 const response = await GET(new Request("http://localhost/api/inventory/internal-use/export?q=abc&reason=internal&department=Tech&storeId=other"));
 expect(response.status).toBe(200);
 expect(read).toHaveBeenCalledWith("own-store", { q: "abc", reason: "internal", department: "Tech", status: undefined, from: undefined, to: undefined, limit: 73 });
 const csv = await response.text();
 expect(csv).toContain('"0.5001"'); expect(csv).toContain('"Vít, ""nhỏ"""'); expect(csv).toContain("'=formula");
 expect(response.headers.get("Content-Disposition")).toContain("attachment");
});
test("unauthorized export cannot read records", async () => {
 allowed = false; read.mockClear(); count.mockClear();
 expect((await GET(new Request("http://localhost/export"))).status).toBe(403);
 expect(read).not.toHaveBeenCalled(); expect(count).not.toHaveBeenCalled();
});
