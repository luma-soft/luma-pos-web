export interface BatchDebtInvoiceInput {
  id: string;
  code: string;
  status: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone?: string | null;
  createdAt: Date | string;
  total: number;
  paid: number;
  currentCustomerDebt: number;
}

/** One movement from the customer's receivable ledger (positive = customer owes more). */
export interface BatchDebtLedgerEntry {
  id: string;
  kind: string;
  code: string;
  orderId: string | null;
  createdAt: Date | string;
  typeLabel: string;
  value: number;
  receiptId?: string | null;
  receiptStatus?: string | null;
}

export interface BatchDebtInvoice {
  id: string;
  code: string;
  createdAt: Date | string;
  total: number;
  paid: number;
  remaining: number;
}

export interface BatchDebtMovement {
  id: string;
  code: string;
  createdAt: Date | string;
  typeLabel: string;
  value: number;
}

export interface BatchDebtSummary {
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  /** Start of the reconciliation period: the oldest selected invoice. */
  periodStart: Date | string;
  invoices: BatchDebtInvoice[];
  invoiceTotal: number;
  invoicePaid: number;
  invoiceRemaining: number;
  /** Payments, returns, adjustments and other invoices inside the period. */
  movements: BatchDebtMovement[];
  openingDebt: number;
  increases: number;
  decreases: number;
  currentDebt: number;
}

const time = (value: Date | string) => new Date(value).getTime();

/**
 * Builds one debt reconciliation page per named customer with at least two
 * selected completed invoices.
 *
 * The statement always balances: openingDebt + increases - decreases = currentDebt.
 * With the customer's ledger, the period runs from the oldest selected invoice to
 * now and every in-period movement is counted; without it, only the selected
 * invoices are counted and everything else falls into the opening balance.
 */
export function buildBatchDebtSummaries(
  inputs: BatchDebtInvoiceInput[],
  ledgers: ReadonlyMap<string, BatchDebtLedgerEntry[]> = new Map(),
): BatchDebtSummary[] {
  const groups = new Map<string, BatchDebtInvoiceInput[]>();

  for (const input of inputs) {
    if (input.status !== "completed" || !input.customerId) continue;
    const group = groups.get(input.customerId) ?? [];
    group.push(input);
    groups.set(input.customerId, group);
  }

  return [...groups.entries()].flatMap(([customerId, group]) => {
    if (group.length < 2) return [];

    const sorted = [...group].sort((a, b) => time(a.createdAt) - time(b.createdAt));
    const invoices = sorted.map((input) => ({
      id: input.id,
      code: input.code,
      createdAt: input.createdAt,
      total: input.total,
      paid: input.paid,
      remaining: Math.max(0, input.total - input.paid),
    }));
    const invoiceTotal = sum(invoices.map((invoice) => invoice.total));
    const invoicePaid = sum(invoices.map((invoice) => invoice.paid));
    const invoiceRemaining = sum(invoices.map((invoice) => invoice.remaining));
    const currentDebt = group[0].currentCustomerDebt;
    const periodStart = sorted[0].createdAt;

    const base = {
      customerId,
      customerName: group[0].customerName || "—",
      customerPhone: group[0].customerPhone ?? null,
      periodStart,
      invoices,
      invoiceTotal,
      invoicePaid,
      invoiceRemaining,
      currentDebt,
    };

    const ledger = ledgers.get(customerId);
    if (!ledger) {
      return [{
        ...base,
        movements: [],
        openingDebt: currentDebt - invoiceTotal + invoicePaid,
        increases: invoiceTotal,
        decreases: invoicePaid,
      }];
    }

    const startTime = time(periodStart);
    const inPeriod = ledger.filter((entry) => time(entry.createdAt) >= startTime);
    const counted = dropVoidedReceipts(inPeriod);
    const selectedIds = new Set(invoices.map((invoice) => invoice.id));
    const movements = counted
      .filter((entry) => !(entry.kind === "sale" && entry.orderId && selectedIds.has(entry.orderId)))
      .sort((a, b) => time(a.createdAt) - time(b.createdAt))
      .map(({ id, code, createdAt, typeLabel, value }) => ({ id, code, createdAt, typeLabel, value }));
    const increases = sum(counted.filter((entry) => entry.value > 0).map((entry) => entry.value));
    const decreases = sum(counted.filter((entry) => entry.value < 0).map((entry) => -entry.value));

    return [{
      ...base,
      movements,
      openingDebt: currentDebt - increases + decreases,
      increases,
      decreases,
    }];
  });
}

/** A receipt cancelled within the same period nets to zero; hide both halves. */
function dropVoidedReceipts(entries: BatchDebtLedgerEntry[]) {
  const voided = new Set(
    entries
      .filter((entry) => entry.kind === "payment_cancellation" && entry.receiptId)
      .map((entry) => entry.receiptId as string)
      .filter((receiptId) => entries.some((entry) => entry.kind === "payment" && entry.receiptId === receiptId)),
  );
  return entries.filter((entry) => !(entry.receiptId && voided.has(entry.receiptId)));
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
