import { describe, expect, test } from "bun:test";
import { unpaidSourceInvoicePaymentDraft } from "./source-invoice-payment";

describe("unpaid source invoice payment draft", () => {
  test("keeps an unpaid sale unpaid while it is being replaced", () => {
    expect(unpaidSourceInvoicePaymentDraft({ mode: "edit", kind: "invoice", amountPaid: 0, customerId: "customer-1" }))
      .toEqual({ payMethod: "credit", paidInput: 0 });
    expect(unpaidSourceInvoicePaymentDraft({ mode: "edit", kind: "invoice", amountPaid: 0 }))
      .toEqual({ payMethod: "cash", paidInput: 0 });
  });

  test("does not change copy, return, quote, booking, or paid invoices", () => {
    expect(unpaidSourceInvoicePaymentDraft({ mode: "copy", kind: "invoice", amountPaid: 0 })).toBeNull();
    expect(unpaidSourceInvoicePaymentDraft({ mode: "return", kind: "invoice", amountPaid: 0 })).toBeNull();
    expect(unpaidSourceInvoicePaymentDraft({ mode: "edit", kind: "quote", amountPaid: 0 })).toBeNull();
    expect(unpaidSourceInvoicePaymentDraft({ mode: "edit", kind: "booking", amountPaid: 0 })).toBeNull();
    expect(unpaidSourceInvoicePaymentDraft({ mode: "edit", kind: "invoice", amountPaid: 1 })).toBeNull();
  });
});
