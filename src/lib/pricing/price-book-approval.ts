export type PriceBookApprovalAction =
  | { action: "create" }
  | { action: "rename" | "delete"; id: string };

export function priceBookApprovalScope(input: PriceBookApprovalAction) {
  return input.action === "create"
    ? "settings:price-books:create"
    : `settings:price-books:${input.id}:${input.action}`;
}
