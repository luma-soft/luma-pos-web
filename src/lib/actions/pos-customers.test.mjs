import { beforeEach, expect, mock, test } from "bun:test";

let gate;
const coreCalls = [];

mock.module("@/lib/actions/common", () => ({
  requireSalesAccess: async () => gate,
}));
mock.module("@/lib/customers/write", () => ({
  createCustomerCore: async (...args) => {
    coreCalls.push(args);
    return { ok: true, data: { id: "customer-1" } };
  },
}));

const { createPosCustomer } = await import("./pos-customers");

beforeEach(() => {
  gate = {
    ok: true,
    storeId: "store-1",
    userId: "cashier-1",
    role: "cashier",
    features: {},
  };
  coreCalls.length = 0;
});

test("POS customer creation uses sales access without triggering app revalidation", async () => {
  const input = {
    name: "Khách có công nợ",
    type: "retail",
    debtLimit: 5_000_000,
    consentStatus: "pending",
    consentPurposes: {},
    consentSource: "web",
  };

  await expect(createPosCustomer(input)).resolves.toEqual({
    ok: true,
    data: { id: "customer-1" },
  });
  expect(coreCalls).toEqual([["store-1", input, "cashier-1"]]);
});

test("POS customer creation returns a denied sales gate without writing", async () => {
  gate = { ok: false, error: "errors.forbidden" };

  await expect(createPosCustomer({ name: "Khách lẻ" })).resolves.toEqual(gate);
  expect(coreCalls).toHaveLength(0);
});
