import { describe, expect, test } from "bun:test";
import {
  assertKiotVietCustomerSourceTotals,
  parseKiotVietCustomerSources,
  planKiotVietCustomerSync,
} from "@/lib/kiotviet/customer-sync";

const managedRow = {
  "Mã khách hàng": " KH-01 ",
  "Tên khách hàng": " Nguyễn Văn A ",
  "Điện thoại": "0901000001",
  Email: "a@example.test",
  "Địa chỉ": "12 Lê Lợi",
  "Phường/Xã": "Phường Bến Nghé",
  "Khu vực giao hàng": "Quận 1",
  "Mã số thuế": "0312345678",
  "Công ty": "Công ty A",
  "Nhóm khách hàng": "VIP",
  "Ghi chú": "Khách cũ",
  "Nợ cần thu hiện tại": -125000,
  "Tổng bán trừ trả hàng": 1250000,
  "Trạng thái": "0",
};

describe("KiotViet customer master synchronization", () => {
  test("projects only source-managed customer fields with signed debt and inactive state", () => {
    expect(parseKiotVietCustomerSources([managedRow])).toEqual([{
      externalId: "KH-01",
      code: "KH-01",
      name: "Nguyễn Văn A",
      phone: "0901000001",
      email: "a@example.test",
      address: "12 Lê Lợi, Phường Bến Nghé, Quận 1",
      taxCode: "0312345678",
      note: "Công ty A · VIP · Khách cũ",
      isActive: false,
      currentDebt: -125000,
      totalSpent: 1250000,
    }]);
  });

  test("plans managed updates without overwriting consent, Zalo, portal, type, or debt limit", () => {
    const plan = planKiotVietCustomerSync({
      sourceRows: [{ ...managedRow, "Trạng thái": "Đang giao dịch" }],
      current: [{
        localId: "customer-1",
        code: "KH-01",
        name: "Tên cũ",
        phone: "0901999999",
        email: "old@example.test",
        address: "Địa chỉ cũ",
        taxCode: "MST cũ",
        note: "Ghi chú cũ",
        isActive: false,
        currentDebt: "0",
        totalSpent: "0",
        legacyImported: true,
        consentStatus: "granted",
        zaloUserId: "zalo-user",
        portalToken: "portal-token",
        type: "contractor",
        debtLimit: "5000000",
      }],
      mappings: [],
      historicalDocumentCustomerCodes: [],
    });

    expect(plan.entityPlan.adopts).toEqual([{
      externalId: "KH-01",
      localId: "customer-1",
      needsUpdate: true,
    }]);
    expect(plan.writes).toEqual([{
      action: "adopt",
      externalId: "KH-01",
      localId: "customer-1",
      customer: {
        code: "KH-01",
        name: "Nguyễn Văn A",
        phone: "0901000001",
        email: "a@example.test",
        address: "12 Lê Lợi, Phường Bến Nghé, Quận 1",
        taxCode: "0312345678",
        note: "Công ty A · VIP · Khách cũ",
        isActive: true,
        currentDebt: -125000,
        totalSpent: 1250000,
      },
    }]);
    expect(plan.summary).toMatchObject({ adopted: 1, debtCorrections: 1, totalSpentCorrections: 1 });
  });

  test("preserves Luma-only customers, inactivates missing source-owned customers, and creates only eligible historical placeholders", () => {
    const plan = planKiotVietCustomerSync({
      sourceRows: [{
        "Mã khách hàng": "KH-ACTIVE",
        "Tên khách hàng": "Active",
        "Nợ cần thu hiện tại": 0,
        "Tổng bán trừ trả hàng": 0,
        "Trạng thái": "Đang giao dịch",
      }],
      current: [
        {
          localId: "mapped-missing",
          code: "KH-OLD",
          name: "Old KiotViet",
          phone: null,
          email: null,
          address: null,
          taxCode: null,
          note: null,
          isActive: true,
          currentDebt: 0,
          totalSpent: 0,
          legacyImported: false,
        },
        {
          localId: "luma-only",
          code: "LUMA-01",
          name: "Luma customer",
          phone: null,
          email: null,
          address: null,
          taxCode: null,
          note: null,
          isActive: true,
          currentDebt: 0,
          totalSpent: 0,
          legacyImported: false,
        },
      ],
      mappings: [{ externalId: "KH-OLD", localId: "mapped-missing" }],
      historicalDocumentCustomerCodes: ["", "  ", "KH-ACTIVE", "KH-HISTORY", "KH-HISTORY"],
    });

    expect(plan.entityPlan.preserves).toEqual([{ localId: "luma-only", code: "LUMA-01" }]);
    expect(plan.inactivations).toEqual([{ externalId: "KH-OLD", localId: "mapped-missing" }]);
    expect(plan.writes).toContainEqual({
      action: "inactivate",
      externalId: "KH-OLD",
      localId: "mapped-missing",
      customer: { isActive: false },
    });
    expect(plan.historicalPlaceholders).toEqual([{
      externalId: "KH-HISTORY",
      code: "KH-HISTORY",
      name: "KiotViet historical customer KH-HISTORY",
      isActive: false,
      currentDebt: 0,
      totalSpent: 0,
      type: "retail",
    }]);
  });

  test("blocks a historical document code that collides with an unproven Luma-only customer", () => {
    const plan = planKiotVietCustomerSync({
      sourceRows: [{
        "Mã khách hàng": "KH-ACTIVE",
        "Tên khách hàng": "Active",
        "Nợ cần thu hiện tại": 0,
        "Tổng bán trừ trả hàng": 0,
        "Trạng thái": "Đang giao dịch",
      }],
      current: [{
        localId: "luma-history",
        code: "KH-HISTORY",
        name: "Luma-only historical collision",
        phone: null,
        email: null,
        address: null,
        taxCode: null,
        note: null,
        isActive: true,
        currentDebt: 0,
        totalSpent: 0,
        legacyImported: false,
      }],
      mappings: [],
      historicalDocumentCustomerCodes: ["KH-HISTORY"],
    });

    expect(plan.historicalPlaceholders).toEqual([]);
    expect(plan.entityPlan.conflicts).toEqual([{
      externalId: "KH-HISTORY",
      localId: "luma-history",
      reason: "code_collision",
    }]);
  });

  test("bootstraps an empty-mapping customer only when its stable name matches", () => {
    const sourceRows = [{
      "Mã khách hàng": "KH-BOOTSTRAP",
      "Tên khách hàng": "Khách bootstrap",
      "Nợ cần thu hiện tại": 500,
      "Tổng bán trừ trả hàng": 900,
      "Trạng thái": "Đang giao dịch",
    }];
    const current = [{
      localId: "customer-bootstrap",
      code: "KH-BOOTSTRAP",
      name: "Khách bootstrap",
      phone: null,
      email: null,
      address: null,
      taxCode: null,
      note: null,
      isActive: true,
      currentDebt: 0,
      totalSpent: 0,
      legacyImported: false,
      legacyBootstrapEligible: true,
    }];
    const adopted = planKiotVietCustomerSync({
      sourceRows,
      current,
      mappings: [],
      historicalDocumentCustomerCodes: [],
    });
    expect(adopted.entityPlan.adopts).toEqual([{
      externalId: "KH-BOOTSTRAP",
      localId: "customer-bootstrap",
      needsUpdate: true,
    }]);

    const collision = planKiotVietCustomerSync({
      sourceRows,
      current: [{ ...current[0], name: "Khách Luma khác" }],
      mappings: [],
      historicalDocumentCustomerCodes: [],
    });
    expect(collision.entityPlan.conflicts).toContainEqual({
      externalId: "KH-BOOTSTRAP",
      localId: "customer-bootstrap",
      reason: "code_collision",
    });
  });

  test("reports the reviewed adoption and correction counts deterministically", () => {
    const sourceRows = Array.from({ length: 103 }, (_, index) => ({
      "Mã khách hàng": `KH-${String(index + 1).padStart(3, "0")}`,
      "Tên khách hàng": `Customer ${index + 1}`,
      "Nợ cần thu hiện tại": index < 11 ? 1 : 0,
      "Tổng bán trừ trả hàng": index < 18 ? 1 : 0,
      "Trạng thái": "Đang giao dịch",
    }));
    const current = sourceRows.slice(0, 95).map((row, index) => ({
      localId: `customer-${index + 1}`,
      code: String(row["Mã khách hàng"]),
      name: String(row["Tên khách hàng"]),
      phone: null,
      email: null,
      address: null,
      taxCode: null,
      note: null,
      isActive: true,
      currentDebt: 0,
      totalSpent: 0,
      legacyImported: true,
    }));

    expect(planKiotVietCustomerSync({
      sourceRows,
      current,
      mappings: [],
      historicalDocumentCustomerCodes: [],
    }).summary).toMatchObject({
      adopted: 95,
      created: 8,
      debtCorrections: 11,
      totalSpentCorrections: 18,
    });
  });

  test("requires the reviewed source debt and net-sales totals before apply", () => {
    expect(() => assertKiotVietCustomerSourceTotals([
      {
        externalId: "KH-TOTALS",
        code: "KH-TOTALS",
        name: "Totals",
        phone: null,
        email: null,
        address: null,
        taxCode: null,
        note: null,
        isActive: true,
        currentDebt: 130924782,
        totalSpent: 3400176291,
      },
    ])).not.toThrow();
    expect(() => assertKiotVietCustomerSourceTotals([])).toThrow("customer debt total");
  });
});
