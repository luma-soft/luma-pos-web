import { expect, test } from "bun:test";
import { inventoryDocumentCapabilities } from "./document-capabilities";
test("inventory document rights match server mutation roles", () => {
 for (const role of ["owner", "manager", "warehouse", "cashier", "sales", "unknown"]) {
  for (const kind of ["internal-use", "purchase-returns"]) {
   const permitted = ["owner", "manager"].includes(role) || (kind === "internal-use" && role === "warehouse");
   expect(inventoryDocumentCapabilities(kind, role)).toEqual({ canEdit: permitted, canDelete: permitted });
  }
 }
});
