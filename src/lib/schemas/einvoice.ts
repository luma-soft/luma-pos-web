import { z } from "zod";

export const issueEInvoiceSchema = z.object({
  orderId: z.uuid(),
  buyerName: z.string().min(1, { error: "validation.required" }),
  buyerTaxCode: z.string().optional(),
  buyerAddress: z.string().max(500).optional(),
  buyerEmail: z.email().optional().or(z.literal("")),
  // Optional for mobile: the server derives the fallback from the completed
  // order when per-product VAT does not provide an override.
  vatRate: z.number().min(0).max(20).optional(),
  requestId: z.string().min(8).max(80),
});

export type IssueEInvoiceInput = z.input<typeof issueEInvoiceSchema>;
