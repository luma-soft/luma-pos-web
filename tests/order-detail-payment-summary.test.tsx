import { describe, expect, mock, test } from "bun:test";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import viMessages from "../messages/vi.json";
import type { OrderDetail } from "@/lib/data/orders";

mock.module("next-intl/server", () => ({
  getTranslations: async () =>
    createTranslator({ locale: "vi", messages: viMessages }),
}));

mock.module("next/navigation", () => ({
  usePathname: () => "/sales",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
    push: () => undefined,
    refresh: () => undefined,
    replace: () => undefined,
  }),
}));

mock.module("@/components/confirm-dialog-provider", () => ({
  useConfirmDialog: () => ({
    alert: async () => undefined,
    confirm: async () => true,
  }),
}));

mock.module("@/lib/auth/store-context", () => ({
  UnauthorizedError: class UnauthorizedError extends Error {
    constructor() {
      super("UNAUTHORIZED");
    }
  },
  getAuthenticatedUser: async () => null,
  profilesBelongToStore: async () => true,
  requireStoreContext: async () => ({ storeId: "store-1" }),
  requireStoreFeature: async () => ({ storeId: "store-1" }),
  requireStoreFeatureRole: async () => ({ storeId: "store-1" }),
  requireStoreRole: async () => ({ storeId: "store-1" }),
  resolveStoreContextForUser: async () => ({ storeId: "store-1" }),
}));

mock.module("@/lib/data/settings", () => ({
  sanitizeStorePrefsForClient: (prefs: unknown) => prefs,
  getAiAttachmentsBucket: async () => null,
  getAiProviderSettings: async () => null,
  getPaymentBankAccounts: async () => [],
  getRawStorePrefs: async () => ({}),
  getShopeeSettings: async () => null,
  getStaff: async () => [],
  getStoreSettings: async () => ({
    prefs: {
      zalo: {
        enabled: false,
        accessTokenSet: false,
        deliveryMode: "oa",
        invoiceTemplateId: null,
      },
    },
  }),
  getZaloSettings: async () => null,
}));

mock.module("@/lib/print/template", () => ({
  getPrintTemplate: async () => null,
  getPrintTemplatesForDoc: async () => [],
}));

function orderWithPaidAmount(amountPaid: number): OrderDetail {
  return {
    id: "order-1",
    code: "HD003233",
    documentType: "sale",
    status: "completed",
    paymentStatus: amountPaid > 0 ? "partial" : "unpaid",
    projectName: null,
    deliveryAddress: null,
    deliveryDate: null,
    subtotal: "1595000",
    discount: "0",
    tax: "0",
    shippingFee: "0",
    total: "1595000",
    amountPaid: String(amountPaid),
    sourceOrderId: null,
    sourceMode: "pos",
    sourceSaleTime: null,
    hasCreatedOrder: false,
    replacedByOrderId: null,
    note: null,
    createdAt: new Date("2026-08-30T05:38:00.000Z"),
    customerId: "customer-1",
    projectId: null,
    customerName: "Anh Hiệp",
    customerPhone: "0986166789",
    customerZaloUserId: null,
    customerType: "retail",
    customerDebt: "595000",
    warehouseName: null,
    priceBookName: "Bảng giá chung",
    sellerName: null,
    items: [],
    payments: [],
    returns: [],
    returnedByItem: {},
  } as OrderDetail;
}

async function renderOrderDetail(amountPaid: number) {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:5432/test";
  try {
    const { OrderDetailPanel } = await import(
      "@/app/(app)/orders/[id]/order-detail-panel"
    );
    const panel = await OrderDetailPanel({
      order: orderWithPaidAmount(amountPaid),
      compact: true,
    });
    return renderToStaticMarkup(
      <NextIntlClientProvider
        locale="vi"
        messages={viMessages}
        timeZone="Asia/Ho_Chi_Minh"
      >
        {panel}
      </NextIntlClientProvider>,
    );
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

function infoValue(html: string, label: string) {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = html.match(
    new RegExp(`${escapedLabel}</span><span[^>]*>([^<]*)</span>`),
  );
  return match?.[1].replace(/&nbsp;|\u00a0/g, " ");
}

describe("order detail payment summary", () => {
  test("shows the amount the customer already paid", async () => {
    const html = await renderOrderDetail(1_000_000);

    expect(infoValue(html, "Đã thanh toán")).toBe("1.000.000 ₫");
  });

  test("keeps the paid row visible when the customer paid zero", async () => {
    const html = await renderOrderDetail(0);

    expect(infoValue(html, "Đã thanh toán")).toBe("0 ₫");
  });
});
