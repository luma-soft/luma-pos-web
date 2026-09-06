export function inventoryDocumentCapabilities(kind: "internal-use" | "purchase-returns", role: string) {
  const canManage = role === "owner" || role === "manager" || (kind === "internal-use" && role === "warehouse");
  return { canEdit: canManage, canDelete: canManage };
}
