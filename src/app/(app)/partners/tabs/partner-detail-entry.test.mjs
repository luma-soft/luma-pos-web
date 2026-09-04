import { beforeEach, describe, expect, mock, test } from "bun:test";

const customerId = "7dca0eeb-dc17-4607-8964-18574c2400e9";
const supplierId = "141ed272-a296-46de-aa2a-9ec124296390";
const customer = { id: customerId, name: "Anh Nhật", salesHistory: [], debtLedger: [] };
const supplier = { id: supplierId, name: "Nhà cung cấp", currentDebt: "0" };
const list = { rows: [], total: 40, page: 2, pageCount: 2, pageSize: 20 };
const getCustomers = mock(async () => list);
const getSuppliers = mock(async () => list);
const getCustomerPartnerDetail = mock(async () => customer);
const getSupplier = mock(async () => supplier);

mock.module("@/lib/data/partners", () => ({ getCustomers, getSuppliers, getCustomerPartnerDetail, getSupplier }));
mock.module("@/lib/auth/store-context", () => ({ requireStoreContext: async () => ({ storeId: "store-1" }) }));
mock.module("@/lib/print/template", () => ({ getPrintTemplatesForDoc: async () => [] }));
mock.module("next-intl/server", () => ({ getTranslations: async () => (key) => key }));
mock.module("./customers-table", () => ({ CustomersTable: () => null }));
mock.module("./suppliers-table", () => ({ SuppliersTable: () => null }));
mock.module("@/components/pagination", () => ({ Pagination: () => null }));

const { CustomersTab } = await import("./customers.tsx");
const { SuppliersTab } = await import("./suppliers.tsx");

beforeEach(() => {
  for (const fn of [getCustomers, getSuppliers, getCustomerPartnerDetail, getSupplier]) fn.mockClear();
});

describe("partner modal deep-link entry", () => {
  test("customer outside the current filtered page is loaded separately for the existing modal", async () => {
    const view = await CustomersTab({ searchParams: { page: "2", q: "another name", detailCustomerId: customerId } });
    expect(getCustomerPartnerDetail).toHaveBeenCalledWith("store-1", customerId);
    expect(getCustomers.mock.calls[0][1]).toMatchObject({ page: 2, q: "another name" });
    expect(view.props.data).toBe(list);
    expect(view.props.data.rows).toHaveLength(0);
    expect(view.props.initialDetailId).toBe(customerId);
    expect(view.props.initialDetailCustomer).toBe(customer);
  });

  test("supplier outside the current filtered page is loaded separately for the existing modal", async () => {
    const view = await SuppliersTab({ searchParams: { page: "2", q: "another name", detailSupplierId: supplierId } });
    const table = view.props.children[0];
    expect(getSupplier).toHaveBeenCalledWith("store-1", supplierId);
    expect(getSuppliers.mock.calls[0][1]).toMatchObject({ page: 2, q: "another name" });
    expect(table.props.rows).toBe(list.rows);
    expect(table.props.initialDetailId).toBe(supplierId);
    expect(table.props.initialDetailSupplier).toBe(supplier);
  });

  test("normal list pages do not fetch or automatically open a partner detail", async () => {
    const customers = await CustomersTab({ searchParams: {} });
    const suppliers = await SuppliersTab({ searchParams: {} });
    expect(getCustomerPartnerDetail).not.toHaveBeenCalled();
    expect(getSupplier).not.toHaveBeenCalled();
    expect(customers.props.initialDetailId).toBeNull();
    expect(suppliers.props.children[0].props.initialDetailId).toBeNull();
  });

  test("invalid IDs keep the not-found modal state without sending malformed UUIDs to the database", async () => {
    const customers = await CustomersTab({ searchParams: { detailCustomerId: "invalid" } });
    const suppliers = await SuppliersTab({ searchParams: { detailSupplierId: "invalid" } });
    expect(getCustomerPartnerDetail).not.toHaveBeenCalled();
    expect(getSupplier).not.toHaveBeenCalled();
    expect(customers.props.initialDetailId).toBe("invalid");
    expect(customers.props.initialDetailCustomer).toBeNull();
    expect(suppliers.props.children[0].props.initialDetailId).toBe("invalid");
    expect(suppliers.props.children[0].props.initialDetailSupplier).toBeNull();
  });

  test("missing or other-store IDs pass through a not-found modal without injecting list rows", async () => {
    getCustomerPartnerDetail.mockResolvedValueOnce(null);
    getSupplier.mockResolvedValueOnce(null);
    const customers = await CustomersTab({ searchParams: { detailCustomerId: customerId } });
    const suppliers = await SuppliersTab({ searchParams: { detailSupplierId: supplierId } });
    expect(customers.props.initialDetailCustomer).toBeNull();
    expect(suppliers.props.children[0].props.initialDetailSupplier).toBeNull();
    expect(customers.props.data.rows).toHaveLength(0);
    expect(suppliers.props.children[0].props.rows).toHaveLength(0);
  });
});
