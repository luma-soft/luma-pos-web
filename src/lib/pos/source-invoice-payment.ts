type SourceInvoicePayment = {
  mode: "edit" | "copy" | "return";
  kind: string;
  amountPaid?: number;
  customerId?: string;
};

/** Keep an unpaid sale unpaid when opening it in the replacement-invoice flow. */
export function unpaidSourceInvoicePaymentDraft(source: SourceInvoicePayment) {
  if (source.mode !== "edit" || source.kind !== "invoice" || source.amountPaid !== 0) return null;
  return { payMethod: source.customerId ? "credit" as const : "cash" as const, paidInput: 0 };
}
