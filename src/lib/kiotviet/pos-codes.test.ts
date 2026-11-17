import { describe, expect, test } from "bun:test";
import { planKiotVietCustomerSync, type KiotVietCustomerCurrent } from "./customer-sync";
import { parseKiotVietDataSyncArgs } from "./data-sync-runner";
import { createKiotVietHistoryProductResolver } from "./history-product-resolver";
import { isKiotVietStyleCode, kiotVietPosCode, withKiotVietSourceIdentities } from "./pos-codes";

const at = new Date("2026-11-17T13:14:54.000Z");

describe("kiotVietPosCode", () => {
  test("uses the Luma POS code shape with the source timestamp in UTC", () => {
    const code = kiotVietPosCode("sale", "HD003430.01", at);
    expect(code).toMatch(/^DH-261117-131454[0-9A-Z]{2}$/);
    expect(isKiotVietStyleCode(code)).toBe(false);
  });

  test("is stable for the same source and moves on for the next attempt", () => {
    expect(kiotVietPosCode("purchase", "PN001280", at)).toBe(kiotVietPosCode("purchase", "PN001280", at));
    expect(kiotVietPosCode("purchase", "PN001280", at, 1)).not.toBe(kiotVietPosCode("purchase", "PN001280", at));
    expect(kiotVietPosCode("customer", "KH000112", at)).toStartWith("KH-261117-");
    expect(kiotVietPosCode("supplier", "NCC000060", at)).toStartWith("NCC-261117-");
    expect(kiotVietPosCode("supplier_return", "THN000076", at)).toStartWith("THN-261117-");
  });

  test("recognises KiotViet-style codes", () => {
    for (const code of ["HD003416", "HD003420.01", "PN001278", "KH000112", "NCC000060", "THN000076"]) {
      expect(isKiotVietStyleCode(code)).toBe(true);
    }
    expect(isKiotVietStyleCode("KH-261105-040000O3")).toBe(false);
  });
});

describe("withKiotVietSourceIdentities", () => {
  test("plans mapped rows under their KiotViet identity and leaves others alone", () => {
    const rows = [{ localId: "a", code: "DH-261117-131454L1" }, { localId: "b", code: "DH-261113-045734TP" }];
    withKiotVietSourceIdentities(rows, new Map([["a", "HD003430.01"]]));
    expect(rows).toEqual([{ localId: "a", code: "HD003430.01" }, { localId: "b", code: "DH-261113-045734TP" }]);
  });
});

describe("--map-customer", () => {
  test("parses reviewed links and only applies them with the customers phase", () => {
    const args = parseKiotVietDataSyncArgs(["dir", "--store=hai-dang", "--map-customer=KH000112=KH-261105-040000O3"]);
    expect(args.customerLinks).toEqual([{ externalId: "KH000112", localCode: "KH-261105-040000O3" }]);
    expect(() => parseKiotVietDataSyncArgs([
      "dir", "--store=hai-dang", "--phase=sales", "--apply", `--source-sha256=${"a".repeat(64)}`,
      "--map-customer=KH000112=KH-261105-040000O3",
    ])).toThrow("--map-customer can only be applied with --phase=customers");
    expect(() => parseKiotVietDataSyncArgs(["dir", "--map-customer=KH000112"])).toThrow();
  });
});

describe("customer sync keeps Luma POS details", () => {
  const local: KiotVietCustomerCurrent = {
    localId: "11111111-1111-4111-8111-111111111111",
    // Already presented under its KiotViet identity by the loader.
    code: "KH000112",
    name: "Ông Nội", phone: null, email: null, address: "Nam Cầu Kiền", taxCode: null, note: null,
    isActive: true, currentDebt: 3_430_000, totalSpent: 3_430_000, legacyImported: false,
  };
  const row = {
    "Mã khách hàng": "KH000112", "Tên khách hàng": " Ông nội", "Điện thoại": "", "Địa chỉ": "",
    "Nợ cần thu hiện tại": 3_430_000, "Tổng bán trừ trả hàng": 3_430_000, "Trạng thái": 1,
  };

  test("a blank KiotViet field or a case-only name difference is not a change", () => {
    const plan = planKiotVietCustomerSync({
      sourceRows: [row], current: [local], mappings: [{ externalId: "KH000112", localId: local.localId }],
      historicalDocumentCustomerCodes: [],
    });
    expect(plan.summary.unchanged).toBe(1);
    expect(plan.writes).toHaveLength(0);
  });

  test("balances still follow KiotViet without clearing POS details", () => {
    const plan = planKiotVietCustomerSync({
      sourceRows: [{ ...row, "Nợ cần thu hiện tại": 3_000_000 }], current: [local],
      mappings: [{ externalId: "KH000112", localId: local.localId }], historicalDocumentCustomerCodes: [],
    });
    expect(plan.writes).toHaveLength(1);
    const write = plan.writes[0]!;
    expect(write.action).toBe("update");
    expect("customer" in write && write.customer).toMatchObject({ name: "Ông Nội", address: "Nam Cầu Kiền", currentDebt: 3_000_000 });
  });
});

describe("product resolver", () => {
  const base = { id: "22222222-2222-4222-8222-222222222222", sku: "SPMWKXCRW2275", baseUnit: "m2" };

  test("resolves a KiotViet SKU through a live product mapping", () => {
    const resolver = createKiotVietHistoryProductResolver({
      currentBaseProducts: [base], productUnits: [], archivedSourceMappings: [], approvedHistoricalPlaceholders: [],
      mappedBaseProducts: [{ externalId: "SP053538", productId: base.id }],
    });
    expect(resolver.resolve({ sku: "SP053538", productName: "Gạch", unitName: "m2" }))
      .toMatchObject({ status: "resolved", productId: base.id, sourceSku: "SP053538", unitMultiplier: 1 });
  });

  test("refuses a mapping whose KiotViet SKU belongs to another product", () => {
    expect(() => createKiotVietHistoryProductResolver({
      currentBaseProducts: [base, { id: "33333333-3333-4333-8333-333333333333", sku: "SP053538", baseUnit: "m2" }],
      productUnits: [], archivedSourceMappings: [], approvedHistoricalPlaceholders: [],
      mappedBaseProducts: [{ externalId: "SP053538", productId: base.id }],
    })).toThrow();
  });
});
