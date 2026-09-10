import { expect, mock, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  redirect: (path) => { throw new Error(`Unexpected redirect to ${path}`); },
}));
mock.module("@/lib/actions/common", () => ({
  requireUser: async () => ({ id: "user-1" }),
  getRole: async () => "cashier",
}));
mock.module("@/components/product-catalog-provider", () => ({
  ProductCatalogProvider: ({ children }) => children,
}));
mock.module("@/components/mobile-tabbar", () => ({ MobileTabBar: () => null }));
mock.module("next-intl", () => ({ NextIntlClientProvider: ({ children }) => children }));
mock.module("next-intl/server", () => ({
  getLocale: async () => "vi",
  getMessages: async () => ({}),
}));

const { useTenantClientScope } = await import("@/components/tenant-client-scope");
const { default: PosLayout } = await import("./layout");

function CustomerDialogScopeProbe() {
  return createElement("span", null, useTenantClientScope());
}

test("POS provides the tenant scope required when the customer dialog mounts", async () => {
  const tree = await PosLayout({ children: createElement(CustomerDialogScopeProbe) });

  expect(() => renderToStaticMarkup(tree)).not.toThrow();
  expect(renderToStaticMarkup(tree)).toContain("user-1:cashier");
});
