import { expect, test } from "bun:test";
import { buildPrintPaymentQr } from "./payment-qr";

const account = {
  bankCode: "VCB",
  gateway: "Vietcombank",
  accountNumber: "0123456789",
  accountName: "HAI DANG",
};
const labels = {
  title: "Thanh toan QR",
  bank: "Ngan hang",
  account: "Tai khoan",
  name: "Chu tai khoan",
  reference: "Noi dung",
};

test("builds a generic account QR for a fully paid invoice", () => {
  const qr = buildPrintPaymentQr({ enabled: true, account, reference: "HD001", labels });
  const params = new URL(qr.qrImageUrl).searchParams;

  expect(qr).not.toBeNull();
  expect(params.has("amount")).toBe(false);
  expect(params.get("des")).toBe("HD001");
});

test("prefills the outstanding amount when the invoice still has a balance", () => {
  const qr = buildPrintPaymentQr({ enabled: true, account, amount: 125000, reference: "HD002", labels });
  expect(new URL(qr.qrImageUrl).searchParams.get("amount")).toBe("125000");
});

test("does not build a QR when the option is disabled or no bank account exists", () => {
  expect(buildPrintPaymentQr({ enabled: false, account, reference: "HD003", labels })).toBeNull();
  expect(buildPrintPaymentQr({ enabled: true, account: null, reference: "HD003", labels })).toBeNull();
});
