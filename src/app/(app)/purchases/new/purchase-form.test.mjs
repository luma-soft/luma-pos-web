import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const translate = (key) => key;
const productId = "00000000-0000-4000-8000-000000000001";
const purchaseId = "00000000-0000-4000-8000-000000000002";
const options = { suppliers: [{ id: "supplier", name: "Nhà cung cấp" }], warehouses: [{ id: "warehouse", name: "Kho" }] };
const products = [{ id: productId, name: "Ống nhựa", sku: "SP001", baseUnit: "m", costPrice: "100000", units: [] }];
const purchase = {
  id: purchaseId, code: "PN001", status: "received", supplierId: "supplier", warehouseId: "warehouse",
  supplierName: "Nhà cung cấp", warehouseName: "Kho", createdAt: new Date("2026-09-04T00:00:00Z"),
  subtotal: "190000", discount: "10000", vatRate: "10", tax: "18000", shippingFee: "20000",
  total: "218000", amountPaid: "50000", note: "", invoiceNumber: "",
  items: [{ id: "item", productId, productName: "Ống nhựa", sku: "SP001", baseUnit: "m", quantity: "2", unitCost: "100000", discount: "10000", total: "190000" }],
};

mock.module("next/navigation", () => ({ useRouter: () => ({ push() {}, refresh() {} }), usePathname: () => "/purchases/new", useSearchParams: () => new URLSearchParams(), notFound: () => { throw new Error("Not found"); } }));
mock.module("next-intl", () => ({ useTranslations: () => translate, useLocale: () => "vi" }));
mock.module("next-intl/server", () => ({ getTranslations: async () => translate }));
mock.module("@/lib/auth/store-context", () => ({ requireStoreContext: async () => ({ storeId: "store-1", role: "owner" }) }));
mock.module("@/components/tenant-client-scope", () => ({ useTenantClientScope: () => ({ storeId: "store-1", userId: "owner" }) }));
mock.module("@/components/product-catalog-provider", () => ({ useProductCatalog: () => ({ search: () => [], refresh: async () => {} }) }));
mock.module("@/components/ai-quick-actions/ai-quick-action-button", () => ({ AiQuickActionButton: () => null }));
mock.module("@/components/ai-quick-actions/ai-quick-action-modal", () => ({ AiQuickActionModal: () => null }));
mock.module("@/lib/actions/purchases", () => ({ createPurchase: async () => ({ ok: false }), updatePurchase: async () => ({ ok: false }), cancelPurchase: async () => ({ ok: false }) }));
mock.module("@/lib/actions/purchase-search", () => ({ resolvePurchaseDraftProducts: async () => [] }));
mock.module("@/lib/data/inventory", () => ({ getPurchase: async () => purchase, getPurchaseFormOptions: async () => options, getPurchaseProductRowsByIds: async () => products }));
mock.module("@/lib/print/template", () => ({ getPrintTemplate: async () => ({ paperDefault: "a4", options: { showDebt: true } }), getPrintTemplatesForDoc: async () => [] }));

const { PurchaseForm } = await import("./purchase-form.tsx");
const { default: EditPurchasePage } = await import("../[id]/edit/page.tsx");
const { default: NewPurchasePage } = await import("./page.tsx");
const { default: PurchaseDetailPage } = await import("../[id]/page.tsx");
const { default: PrintPurchasePage } = await import("../[id]/print/page.tsx");
const { ConfirmDialogProvider } = await import("@/components/confirm-dialog-provider");

beforeEach(() => { purchase.shippingFee = "20000"; });

function initialValues(shippingFee) {
  return {
    supplierId: "supplier", warehouseId: "warehouse", discount: 10000, vatRate: 10,
    shippingFee, invoiceNumber: "", amountPaid: 50000, note: "",
    items: [{ productId, quantity: 2, unitCost: 100000, discount: 10000 }],
  };
}

describe("purchase freight", () => {
  test("form includes freight after discount and VAT in total and debt", () => {
    const html = renderToStaticMarkup(createElement(PurchaseForm, { options, initialProducts: products, initialValues: initialValues(20000), mode: "edit", purchaseId }));
    expect(html).toContain('for="purchase-shipping-fee"');
    expect(html).toContain("Phí vận chuyển");
    expect(html).toContain('id="purchase-shipping-fee"');
    expect(html).toContain('value="20.000"');
    expect(html).toContain("218.000");
    expect(html).toContain("168.000");
  });

  test("older form seeds without freight default to zero", () => {
    const html = renderToStaticMarkup(createElement(PurchaseForm, { options, initialProducts: products, initialValues: initialValues(undefined), mode: "edit", purchaseId }));
    expect(html).toContain("198.000");
    expect(html).toContain("148.000");
    expect(html).not.toContain("NaN");
  });

  test("edit and copy keep the recorded freight", async () => {
    const edit = await EditPurchasePage({ params: Promise.resolve({ id: purchaseId }) });
    const copy = await NewPurchasePage({ searchParams: Promise.resolve({ copyFrom: purchaseId }) });
    expect(edit.props.initialValues.shippingFee).toBe(20000);
    expect(copy.props.initialValues.shippingFee).toBe(20000);
  });

  test("detail explains the freight included in the purchase total", async () => {
    const html = renderToStaticMarkup(createElement(ConfirmDialogProvider, null, await PurchaseDetailPage({ params: Promise.resolve({ id: purchaseId }) })));
    expect(html).toContain("Phí vận chuyển");
    expect(html).toContain("20.000");
    expect(html).toContain("218.000");
  });

  test("print passes freight as a separate total with the saved grand total", async () => {
    const page = await PrintPurchasePage({ params: Promise.resolve({ id: purchaseId }), searchParams: Promise.resolve({}) });
    const doc = page.props.children[1].props.children;
    expect(doc.props.totals).toContainEqual({ label: "Phí vận chuyển", value: 20000, kind: "shipping" });
    expect(doc.props.grandTotal).toBe(218000);
  });
});
