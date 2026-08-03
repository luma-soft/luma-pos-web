export const STAFF_ROLES = [
  "owner",
  "manager",
  "cashier",
  "warehouse",
  "technician",
] as const;

export type Role = (typeof STAFF_ROLES)[number];

export const OWNER_ROLES = ["owner"] as const satisfies readonly Role[];
export const MANAGER_ROLES = [
  "owner",
  "manager",
] as const satisfies readonly Role[];
export const SALES_ACCESS_ROLES = [
  "owner",
  "manager",
  "cashier",
] as const satisfies readonly Role[];
export const STOCK_ACCESS_ROLES = [
  "owner",
  "manager",
  "warehouse",
] as const satisfies readonly Role[];

// Cashiers need a current stock snapshot to sell safely, but must not be able
// to mutate stock, create receipts, or balance a count.
export const STOCK_READ_ROLES = [
  ...STOCK_ACCESS_ROLES,
  "cashier",
] as const satisfies readonly Role[];
