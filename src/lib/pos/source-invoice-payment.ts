type SourceInvoicePayment = {
  mode: "edit" | "draft_edit" | "copy" | "return";
  kind: string;
  amountPaid?: number;
  customerId?: string;
};

/** Keep an unpaid source invoice unpaid in edit flows. */
export function unpaidSourceInvoicePaymentDraft(source: SourceInvoicePayment) {
  if ((source.mode !== "edit" && source.mode !== "draft_edit") || source.kind !== "invoice" || source.amountPaid !== 0) return null;
  return { payMethod: source.customerId ? "credit" as const : "cash" as const, paidInput: 0 };
}
