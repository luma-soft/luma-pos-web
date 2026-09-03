import { Routes } from "@/lib/routes";
import type { NotificationAction } from "./notification-view-model";

export function notificationHref(action?: NotificationAction) {
  if (action?.href && (/^https?:\/\//i.test(action.href) || action.href.startsWith("/"))) {
    return action.href;
  }
  const id = action?.id;
  return switchTarget(action?.target, id);
}

function switchTarget(target?: string, id?: string) {
  switch (target) {
    case "aiRestocking":
    case "restocking":
      return id ? Routes.purchaseNewForProduct(encodeURIComponent(id)) : Routes.PurchaseNew;
    case "inventory":
      return Routes.Inventory;
    case "purchases":
      return id ? Routes.purchase(id) : Routes.Purchases;
    case "invoices":
    case "einvoice":
      return id ? Routes.salesOrder(id) : `${Routes.Sales}?tab=orders`;
    case "customers":
    case "crm":
    case "debt":
      return id ? `/partners?tab=customers&expandedCustomer=${encodeURIComponent(id)}` : `${Routes.Partners}?tab=customers`;
    case "reports":
    case "sales":
      return Routes.Reports;
    case "shift":
      return "/finance?tab=shifts";
    case "paymentReconciliation":
      return "/finance?tab=payments";
    case "services":
      return id ? `${Routes.Services}?job=${encodeURIComponent(id)}` : Routes.Services;
    default:
      return null;
  }
}
