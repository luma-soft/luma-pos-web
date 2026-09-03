import { activityObject, activityText, type NotificationActivity } from "./activity-presentation";

export const activityFieldKinds = {
  quantity: "number", beforeQuantity: "number", plannedQuantity: "number", usedQuantity: "number",
  issuedBaseQuantity: "number", reservedQuantity: "number", quantityDelta: "number",
  total: "money", amount: "money", amountPaid: "money", totalRefund: "money", difference: "money",
  currentDebt: "money", balance: "money", discount: "money", shippingFee: "money", unitPrice: "money",
  costPrice: "money", retailPrice: "money", wholesalePrice: "money", contractorPrice: "money", agentPrice: "money",
  price: "money", unitCost: "money", laborCharge: "money", materialCharge: "money",
  openingFloat: "money", expectedCash: "money", countedCash: "money", variance: "money",
  status: "enum", paymentStatus: "enum", refundStatus: "enum", method: "enum", documentType: "enum",
  priority: "enum", serviceStage: "enum", serviceType: "enum", lifecycleStatus: "enum", productKind: "enum",
  role: "enum", stockMode: "enum", visitStatus: "enum", category: "enum", type: "enum",
  isActive: "boolean", enabled: "boolean", isEnabled: "boolean", isDefault: "boolean", isPrimary: "boolean",
  priceByWeight: "boolean", trackBatches: "boolean", isAcceptanceRequired: "boolean",
  itemCount: "number", changedCount: "number", variantCount: "number", assetCount: "number", orderCount: "number",
  checklistCompleted: "number", checklistTotal: "number", progressPercent: "number", intervalDays: "number",
  vatRate: "number", shelfLifeDays: "number", version: "number",
  dueOn: "date", lastCompletedOn: "date", scheduledAt: "date", startsOn: "date", targetEndsOn: "date", nextDueOn: "date", incurredOn: "date",
  installedAt: "date", signedAt: "date", customerWarrantyEndsOn: "date", supplierWarrantyEndsOn: "date",
  name: "text", title: "text", sku: "text", code: "text", barcode: "text", baseUnit: "text", unitName: "text",
  warehouseName: "text", customerName: "text", supplierName: "text", projectName: "text", tableName: "text",
  orderCode: "text", exchangeOrderCode: "text", nextShiftCode: "text", targetName: "text", driver: "text",
  vehicle: "text", location: "text", locationLabel: "text", assetName: "text", model: "text", brand: "text",
  serialNumber: "text", signedBy: "text", assigneeName: "text", assignmentRole: "enum",
  reason: "text", note: "text", description: "text", fileName: "text",
  items: "collection", replacementItems: "collection", products: "collection", units: "collection",
  prices: "collection", suppliers: "collection", comboItems: "collection", media: "collection", imageUrls: "collection",
} as const;

export type ActivityField = keyof typeof activityFieldKinds;
export type ActivityChange = { key: ActivityField; before: unknown; after: unknown; hasBefore: boolean; hasAfter: boolean };

/** A bounded, explicit display contract: arbitrary metadata/IDs never become user-facing labels. */
export function activityChanges(row: NotificationActivity): ActivityChange[] {
  const before = activityObject(row.before);
  const after = activityObject(row.after);
  return (Object.keys(activityFieldKinds) as ActivityField[]).flatMap((key) => {
    const hasBefore = Object.hasOwn(before, key);
    const hasAfter = Object.hasOwn(after, key);
    if (!hasBefore && !hasAfter) return [];
    if (hasBefore && !hasAfter && row.after !== null) return [];
    if (hasBefore && hasAfter && JSON.stringify(before[key]) === JSON.stringify(after[key])) return [];
    // A partial snapshot omitting an unchanged identity is not a deletion of it.
    if (["name", "title", "code", "sku"].includes(key) && (!hasBefore || !hasAfter)) return [];
    return [{ key, before: before[key], after: after[key], hasBefore, hasAfter }];
  });
}

export type ActivityItem = { name: string; unit: string | null; beforeQuantity: unknown; quantity: unknown; unitPrice: unknown };

export function activityItems(row: NotificationActivity, field: "items" | "replacementItems" = "items"): ActivityItem[] {
  const before = activityObject(row.before)[field];
  const after = activityObject(row.after)[field];
  const oldItems = Array.isArray(before) ? before.map(activityObject) : [];
  const newItems = Array.isArray(after) ? after.map(activityObject) : [];
  const key = (item: Record<string, unknown>) => `${item.productId ?? item.id ?? item.productName ?? item.name}|${item.unitName ?? ""}`;
  const oldByKey = new Map(oldItems.map((item) => [key(item), item]));
  const newByKey = new Map(newItems.map((item) => [key(item), item]));
  const candidates = newItems.length || oldItems.length
    ? [...newItems, ...oldItems.filter((item) => !newByKey.has(key(item)))]
    : field === "items" && Array.isArray(row.affectedRecords)
      ? row.affectedRecords.map(activityObject).filter((item) => (item.type === "product" || item.entityType === "product") && "quantity" in item)
      : [];
  return candidates.flatMap((item) => {
    const name = activityText(item.productName) ?? activityText(item.name) ?? activityText(item.code);
    if (!name) return [];
    const previous = oldByKey.get(key(item));
    const next = newByKey.get(key(item));
    return [{
      name, unit: activityText(item.unitName),
      beforeQuantity: previous?.quantity ?? item.beforeQuantity,
      quantity: next?.quantity ?? (Array.isArray(after) && previous && !next ? 0 : item.quantity),
      unitPrice: item.unitPrice ?? item.unitCost,
    }];
  });
}
