import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
mock.module("next/navigation", () => ({ useRouter: () => ({ replace() {}, refresh() {} }) }));
mock.module("next-intl", () => ({ useTranslations: () => value => value }));
mock.module("@/components/confirm-dialog-provider", () => ({ useConfirmDialog: () => ({ confirm: async () => true }) }));
mock.module("@/components/product-catalog-provider", () => ({ useProductCatalog: () => ({ refresh() {} }) }));
mock.module("@/lib/actions/internal-use", () => ({ deleteInternalUse: async () => ({ ok: true }) }));
mock.module("@/lib/actions/purchase-returns", () => ({ deletePurchaseReturn: async () => ({ ok: true }) }));
const { InventoryDocumentActions } = await import("./inventory-document-actions");
for (const kind of ["internal-use", "purchase-returns"]) {
 test(kind + " actions fail closed while retaining print", () => {
  for (const capabilities of [undefined, { canEdit: false, canDelete: false }, { canEdit: true, canDelete: true }]) {
   const html = renderToStaticMarkup(createElement(InventoryDocumentActions, { kind, id: "id", code: "CODE", capabilities }));
   expect(html).toContain(`/${kind}/id/print`);
   expect(html.includes(`/${kind}/id/edit`)).toBe(capabilities?.canEdit === true);
   expect(html.includes("Xóa</button>")).toBe(capabilities?.canDelete === true);
  }
 });
}
