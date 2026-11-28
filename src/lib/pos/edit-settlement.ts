export type EditExcessChoice = "credit" | "refund";

/**
 * Payment math for editing a paid invoice. Mirrors the backend's
 * resolveEditSettlement: money already collected stays on the invoice, the
 * cashier only enters what is collected now, and a lower total leaves an
 * excess that is refunded (always for walk-in sales) or kept as credit.
 */
export function editSettlement(input: {
  total: number;
  alreadyPaid: number;
  hasCustomer: boolean;
  choice?: EditExcessChoice;
}) {
  const alreadyPaid = Math.max(0, input.alreadyPaid);
  const due = Math.max(0, input.total - alreadyPaid);
  const excess = Math.max(0, alreadyPaid - input.total);
  const excessChoice: EditExcessChoice = input.hasCustomer ? input.choice ?? "credit" : "refund";
  return { alreadyPaid, due, excess, excessChoice, refund: excessChoice === "refund" ? excess : 0 };
}
