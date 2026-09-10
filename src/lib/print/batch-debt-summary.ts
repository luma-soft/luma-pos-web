export interface BatchDebtInvoiceInput {
  id: string;
  code: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  createdAt: Date | string;
  total: number;
  paid: number;
  currentCustomerDebt: number;
}

export interface BatchDebtInvoice {
  id: string;
  code: string;
  createdAt: Date | string;
  total: number;
  paid: number;
  remaining: number;
}

export interface BatchDebtSummary {
  customerId: string;
  customerName: string;
  invoices: BatchDebtInvoice[];
  openingDebt: number;
  batchTotal: number;
  batchPaid: number;
  batchRemaining: number;
  currentDebt: number;
}

/**
 * Builds one debt reconciliation page per named customer in a batch.
 * Opening debt is the current customer balance excluding the selected invoices.
 */
export function buildBatchDebtSummaries(inputs: BatchDebtInvoiceInput[]): BatchDebtSummary[] {
  const groups = new Map<string, BatchDebtInvoiceInput[]>();

  for (const input of inputs) {
    if (input.status !== "completed" || !input.customerId) continue;
    const group = groups.get(input.customerId) ?? [];
    group.push(input);
    groups.set(input.customerId, group);
  }

  return [...groups.entries()].flatMap(([customerId, group]) => {
    if (group.length < 2) return [];

    const invoices = group.map((input) => ({
      id: input.id,
      code: input.code,
      createdAt: input.createdAt,
      total: input.total,
      paid: input.paid,
      remaining: Math.max(0, input.total - input.paid),
    }));
    const batchTotal = invoices.reduce((sum, invoice) => sum + invoice.total, 0);
    const batchPaid = invoices.reduce((sum, invoice) => sum + invoice.paid, 0);
    const batchRemaining = invoices.reduce((sum, invoice) => sum + invoice.remaining, 0);
    const currentDebt = group[0].currentCustomerDebt;

    return [{
      customerId,
      customerName: group[0].customerName || "—",
      invoices,
      openingDebt: currentDebt - batchRemaining,
      batchTotal,
      batchPaid,
      batchRemaining,
      currentDebt,
    }];
  });
}
