/**
 * Centralized route definitions. Type-safe, single source of truth.
 * Usage: router.push(Routes.Dashboard) or <Link href={Routes.product(id)} />
 */
export const Routes = {
  // Auth
  Login: "/login",
  Register: "/register",

  // App
  Home: "/",
  Dashboard: "/dashboard",
  POS: "/pos",
  // Nhóm trang có tab (gộp)
  Sales: "/sales",
  Partners: "/partners",
  Finance: "/finance",
  Orders: "/orders",
  Quotes: "/quotes",
  Cashbook: "/cashbook",
  Delivery: "/delivery",
  Projects: "/projects",
  Promotions: "/promotions",
  EInvoices: "/einvoices",
  Products: "/products",
  ProductNew: "/products/new",
  Categories: "/products/categories",
  Pricing: "/pricing",
  Inventory: "/inventory",
  InternalUseNew: "/internal-use/new",
  Stocktakes: "/stocktakes",
  StocktakeNew: "/stocktakes/new",
  Purchases: "/purchases",
  PurchaseNew: "/purchases/new",
  Customers: "/customers",
  Suppliers: "/suppliers",
  Reports: "/reports",
  Notifications: "/notifications",
  Settings: "/settings",

  // Param routes
  order: (id: string) => `/orders/${id}` as const,
  product: (id: string) => `/inventory?tab=products&expanded=${id}` as const,
  productEdit: (id: string) => `/products/${id}/edit` as const,
  productCopy: (id: string) => `/products/new?copyFrom=${id}` as const,
  productSameType: (id: string) => `/products/new?sameTypeAs=${id}` as const,
  productLabels: (id: string) => `/products/${id}/labels` as const,
  purchase: (id: string) => `/purchases/${id}` as const,
  purchaseEdit: (id: string) => `/purchases/${id}/edit` as const,
  purchaseCopy: (id: string) => `/purchases/new?copyFrom=${id}` as const,
  purchaseNewForProduct: (id: string) => `/purchases/new?productId=${id}` as const,
  customer: (id: string) => `/customers/${id}` as const,
  supplier: (id: string) => `/suppliers/${id}` as const,
  project: (id: string) => `/projects/${id}` as const,
} as const;

export type Route = typeof Routes[keyof typeof Routes];
