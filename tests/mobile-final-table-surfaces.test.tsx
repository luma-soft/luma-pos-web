import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "../messages/vi.json";

const capturedDataTableProps: Record<string, unknown>[] = [];
const capturedProjectEditProps: Record<string, unknown>[] = [];

mock.module("@/components/data-table", () => ({
  DataTableShell: (props: Record<string, unknown>) => {
    capturedDataTableProps.push(props);
    return <div data-testid="captured-data-table" />;
  },
  RowPreviewModal: () => null,
  stopRowToggle: () => undefined,
}));
mock.module("@/lib/actions/price-books", () => ({
  createPriceBook: async () => ({ ok: true }),
  renamePriceBook: async () => ({ ok: true }),
  deletePriceBook: async () => ({ ok: true }),
  setProductPrice: async () => ({ ok: true }),
  applyPriceFormulaAll: async () => ({ ok: true }),
}));
mock.module("@/lib/actions/stocktakes", () => ({
  balanceStocktake: async () => ({ ok: true }),
  cancelStocktake: async () => ({ ok: true }),
}));
mock.module("@/lib/actions/products", () => ({
  deleteProduct: async () => ({ ok: true }),
  setProductActive: async () => ({ ok: true }),
  setCameraMaterial: async () => ({ ok: true }),
  bulkDeleteProducts: async () => ({
    ok: true,
    data: { deleted: 0, failedIds: [] },
  }),
  bulkStopSellingProducts: async () => ({ ok: true }),
}));
mock.module("@/lib/actions/extras", () => ({
  createPromotion: async () => ({ ok: true }),
  togglePromotion: async () => ({ ok: true }),
  createProject: async () => ({ ok: true }),
  toggleProjectStatus: async () => ({ ok: true }),
  updateProject: async () => ({ ok: true }),
}));
mock.module("@/lib/actions/services", () => ({
  createServiceProject: async () => ({ ok: true }),
  createInstalledAsset: async () => ({ ok: true }),
  createServiceJob: async () => ({ ok: true }),
  createWarrantyClaim: async () => ({ ok: true }),
  deleteServiceCostEntry: async () => ({ ok: true }),
  deleteServiceHandoverDocument: async () => ({ ok: true }),
  completeServiceMaintenancePlan: async () => ({ ok: true }),
  deleteServiceMaintenancePlan: async () => ({ ok: true }),
  releaseServiceJobMaterialReservations: async () => ({ ok: true }),
  reserveServiceJobMaterial: async () => ({ ok: true }),
  saveServiceJobMaterial: async () => ({ ok: true }),
  saveServiceCostEntry: async () => ({ ok: true }),
  saveServiceHandoverDocument: async () => ({ ok: true }),
  saveServiceMaintenancePlan: async () => ({ ok: true }),
  syncServiceJobMaterialStock: async () => ({ ok: true }),
  transitionServiceJob: async () => ({ ok: true }),
  transitionWarrantyClaim: async () => ({ ok: true }),
  updateInstalledAsset: async () => ({ ok: true }),
  updateServiceJob: async () => ({ ok: true }),
  updateServiceChecklist: async () => ({ ok: true }),
  updateWarrantyClaim: async () => ({ ok: true }),
}));
mock.module("@/app/(app)/promotions/promo-widgets", () => ({
  PromoToggle: () => null,
}));
mock.module("@/app/(app)/projects/project-widgets", () => ({
  ProjectEdit: (props: Record<string, unknown>) => {
    capturedProjectEditProps.push(props);
    return <button type="button" className="min-h-11 min-w-11">Sửa</button>;
  },
  ProjectToggle: () => null,
}));
mock.module("@/lib/actions/product-catalog", () => ({
  checkProductCatalogRevision: async () => ({ revision: "test" }),
  syncProductCatalog: async () => ({ revision: "test", products: [] }),
}));

function renderWithMessages(node: ReactNode) {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="vi"
      messages={viMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {node}
    </NextIntlClientProvider>,
  );
}

function elementsOfType(
  node: ReactNode,
  type: unknown,
): React.ReactElement<Record<string, unknown>>[] {
  const matches: React.ReactElement<Record<string, unknown>>[] = [];
  const visit = (child: ReactNode) => {
    if (!isValidElement(child)) return;
    if (child.type === type) {
      matches.push(child as React.ReactElement<Record<string, unknown>>);
    }
    Children.forEach(
      (child.props as { children?: ReactNode }).children,
      visit,
    );
  };
  visit(node);
  return matches;
}

describe("final mobile table surfaces", () => {
  test("pricing row renders and wires every price book editor", async () => {
    const {
      PriceBookEditor,
      PricingMobileRow,
    } = await import("@/app/(app)/pricing/pricing-table");
    const changes: unknown[][] = [];
    const formulas: unknown[][] = [];
    const commits: unknown[][] = [];
    const row = {
      id: "product-1",
      sku: "CAM-01",
      name: "Camera sân vườn",
      baseUnit: "cái",
      costPrice: 750_000,
      lastPurchase: 700_000,
      prices: {
        retail: 1_000_000,
        contractor: 900_000,
      },
    };
    const books = [
      { id: "retail", name: "Giá lẻ", isDefault: true, sortOrder: 0 },
      {
        id: "contractor",
        name: "Giá công trình",
        isDefault: false,
        sortOrder: 1,
      },
    ];
    const props = {
      row,
      books,
      defaultBookId: "retail",
      savingCell: new Set<string>(),
      savedCell: new Set<string>(),
      labels: {
        costPrice: "Giá vốn",
        lastPurchase: "Giá nhập cuối",
        formulaTitle: "Đặt giá theo công thức",
        belowCost: "Giá thấp hơn giá vốn!",
      },
      onOpenFormula: (rowId: string, bookId: string) => {
        formulas.push([rowId, bookId]);
      },
      onPriceChange: (rowId: string, bookId: string, value: number | null) => {
        changes.push([rowId, bookId, value]);
      },
      onPriceCommit: (
        commitRow: typeof row,
        bookId: string,
        value: number | null,
      ) => {
        commits.push([commitRow.id, bookId, value]);
      },
    };

    const mobileRow = PricingMobileRow(props);
    const html = renderToStaticMarkup(mobileRow);
    const editors = elementsOfType(mobileRow, PriceBookEditor);

    expect(html).toContain("Camera sân vườn");
    expect(html).toContain("Giá lẻ");
    expect(html).toContain("Giá công trình");
    expect(html).toContain("1.000.000");
    expect(html).toContain("900.000");
    expect(html).toContain("min-h-11");
    expect(editors).toHaveLength(2);

    (
      editors[1].props.onChange as (value: number | null) => void
    )(925_000);
    (editors[0].props.onOpenFormula as () => void)();
    (
      editors[1].props.onCommit as (value: number | null) => void
    )(930_000);
    expect(changes).toEqual([["product-1", "contractor", 925_000]]);
    expect(formulas).toEqual([["product-1", "retail"]]);
    expect(commits).toEqual([["product-1", "contractor", 930_000]]);
  });

  test("stocktake row keeps cancel and balance actions on the mobile card", async () => {
    const { StocktakeMobileRow } = await import(
      "@/app/(app)/inventory/tabs/stocktakes-table"
    );
    const actionCalls: unknown[][] = [];
    const row = {
      id: "stocktake-1",
      code: "KK0001",
      status: "draft",
      note: "Kiểm lại kệ camera",
      createdAt: "2026-07-28T08:00:00+07:00",
      balancedAt: null,
      warehouseName: "Kho trung tâm",
      byName: "Nguyễn An",
      itemCount: 12,
      totalDiff: "-3",
    };
    const html = renderWithMessages(
      <StocktakeMobileRow
        row={row}
        renderActions={(actionRow) => {
          actionCalls.push([actionRow.id, actionRow.status]);
          return (
            <>
              <button type="button" className="min-h-11 min-w-11">Hủy</button>
              <button type="button" className="min-h-11 min-w-11">Cân bằng kho</button>
            </>
          );
        }}
      />,
    );

    expect(html).toContain("KK0001");
    expect(html).toContain("Kho trung tâm");
    expect(html).toContain("12");
    expect(html).toContain("-3");
    expect(html).toContain("Nguyễn An");
    expect(html).toContain("Kiểm lại kệ camera");
    expect(html).toContain("Phiếu tạm");
    expect(html).toContain("Hủy");
    expect(html).toContain("Cân bằng kho");
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(actionCalls).toEqual([["stocktake-1", "draft"]]);
    expect(html.startsWith("<article")).toBe(true);
  });

  test("promotion row keeps its toggle seam with tiers and period", async () => {
    const { PromotionMobileRow } = await import(
      "@/app/(app)/sales/tabs/promotions-table"
    );
    const actionCalls: unknown[][] = [];
    const row = {
      id: "promotion-1",
      name: "Giảm giá camera dự án",
      tiers: [
        { minQty: 5, discountPct: 3 },
        { minQty: 10, discountPct: 5 },
      ],
      isActive: true,
      startsAt: "2026-07-01T00:00:00+07:00",
      endsAt: "2026-08-31T23:59:59+07:00",
      productName: "Camera H6C Pro",
      baseUnit: "cái",
    };
    const html = renderWithMessages(
      <PromotionMobileRow
        row={row}
        renderActions={(actionRow) => {
          actionCalls.push([actionRow.id, actionRow.isActive]);
          return <button type="button" className="min-h-11 min-w-11">Tạm dừng</button>;
        }}
      />,
    );

    expect(html).toContain("Giảm giá camera dự án");
    expect(html).toContain("Camera H6C Pro · cái");
    expect(html).toContain("≥5 cái → -3%");
    expect(html).toContain("≥10 cái → -5%");
    expect(html).toContain("30/06/2026");
    expect(html).toContain("31/08/2026");
    expect(html).toContain("Đang chạy");
    expect(html).toContain("Tạm dừng");
    expect(html).toContain("min-h-11");
    expect(actionCalls).toEqual([["promotion-1", true]]);
    expect(html.startsWith("<article")).toBe(true);
  });

  test("project row keeps edit and status seams beside its detail link", async () => {
    const { ProjectMobileRow } = await import(
      "@/app/(app)/partners/tabs/projects-table"
    );
    const actionCalls: unknown[][] = [];
    const row = {
      id: "project-1",
      name: "Công trình biệt thự An Phú",
      customerId: "customer-1",
      address: "12 Nguyễn Văn Hưởng, Thảo Điền",
      note: "Ưu tiên bàn giao cuối tuần",
      status: "active",
      serviceType: null,
      serviceStage: null,
      progressPercent: 0,
      startsOn: null,
      targetEndsOn: null,
      siteContactName: null,
      siteContactPhone: null,
      customerName: "Nguyễn Văn An",
      orderCount: 3,
      totalValue: "125000000",
      remaining: "15000000",
      createdAt: new Date("2026-07-28T08:00:00+07:00"),
    };
    const html = renderWithMessages(
      <ProjectMobileRow
        row={row}
        renderActions={(actionRow) => {
          actionCalls.push([actionRow.id, actionRow.status]);
          return (
            <>
              <button type="button" className="min-h-11 min-w-11">Sửa</button>
              <button type="button" className="min-h-11 min-w-11">Hoàn tất</button>
            </>
          );
        }}
      />,
    );

    expect(html).toContain("Công trình biệt thự An Phú");
    expect(html).toContain("Nguyễn Văn An");
    expect(html).toContain("12 Nguyễn Văn Hưởng, Thảo Điền");
    expect(html).toContain("3");
    expect(html).toContain("125.000.000");
    expect(html).toContain("15.000.000");
    expect(html).toContain("Đang chạy");
    expect(html).toContain("Ưu tiên bàn giao cuối tuần");
    expect(html).toContain("Xem chi tiết");
    expect(html).toContain('href="/projects/project-1"');
    expect(html).toContain("Sửa");
    expect(html).toContain("Hoàn tất");
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(3);
    expect(actionCalls).toEqual([["project-1", "active"]]);
    expect(html.startsWith("<article")).toBe(true);
  });

  test("service projects table binds its mobile renderer to the exact row and editor props", async () => {
    const { ServiceProjectsTable } = await import(
      "@/app/(app)/services/service-widgets"
    );
    const row = {
      id: "service-project-1",
      name: "Lắp camera nhà xưởng Bình Minh",
      customerId: "customer-1",
      customerName: "Công ty Bình Minh",
      address: "KCN Sóng Thần, Bình Dương",
      note: "Thi công ngoài giờ",
      status: "active",
      serviceType: "camera",
      serviceStage: "active",
      progressPercent: 65,
      startsOn: "2026-07-01",
      targetEndsOn: "2026-08-15",
      siteContactName: "Anh Minh",
      siteContactPhone: "0909000000",
      jobCount: 5,
      openJobCount: 2,
      assetCount: 4,
      openClaimCount: 1,
      createdAt: new Date("2026-07-01T08:00:00+07:00"),
    };
    const otherRow = {
      ...row,
      id: "service-project-other",
      name: "Công trình không được chọn",
      serviceStage: "planning",
    };
    const rows = [otherRow, row];
    const customers = [
      { id: "customer-1", name: "Công ty Bình Minh" },
      { id: "customer-2", name: "Khách hàng khác" },
    ];
    capturedDataTableProps.length = 0;
    capturedProjectEditProps.length = 0;

    renderWithMessages(
      <ServiceProjectsTable rows={rows} customers={customers} />,
    );
    expect(capturedDataTableProps).toHaveLength(1);
    const tableProps = capturedDataTableProps[0];
    expect(tableProps.tableId).toBe("services.projects");
    expect(tableProps.rows).toBe(rows);
    expect(tableProps.renderMobileRow).toBeFunction();

    const renderMobileRow = tableProps.renderMobileRow as (props: {
      row: typeof row;
      expanded: boolean;
      toggle: () => void;
    }) => ReactNode;
    const html = renderWithMessages(
      renderMobileRow({ row, expanded: false, toggle: () => undefined }),
    );
    expect(html).toContain("Lắp camera nhà xưởng Bình Minh");
    expect(html).not.toContain("Công trình không được chọn");
    expect(html).toContain("Camera");
    expect(html).toContain("Công ty Bình Minh");
    expect(html).toContain("65%");
    expect(html).toContain("2/5");
    expect(html).toContain(">4<");
    expect(html).toContain(">1<");
    expect(html).toContain("Đang thi công");
    expect(html).toContain("KCN Sóng Thần, Bình Dương");
    expect(html).toContain("2 lệnh việc chưa hoàn tất");
    expect(html).toContain("4 thiết bị đang lắp đặt");
    expect(html).toContain("Xem chi tiết");
    expect(html).toContain('href="/projects/service-project-1"');
    expect(html).toContain("Sửa");
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.startsWith("<article")).toBe(true);
    expect(capturedProjectEditProps).toHaveLength(1);
    expect(capturedProjectEditProps[0].project).toBe(row);
    expect(capturedProjectEditProps[0].customers).toBe(customers);
  });

  test("product mobile row and select-all toolbar invoke the existing selection seams", async () => {
    const {
      ProductMobileRow,
      ProductMobileSelectionToolbar,
      SelectionCheckbox,
    } = await import("@/app/(app)/inventory/tabs/products-table");
    const calls: string[] = [];
    const product = {
      id: "product-mobile-1",
      name: "Camera chọn hàng loạt",
      sku: "CAM-BATCH",
      categoryName: "Camera",
      productKind: "product",
      imageUrls: [],
      minRetailPrice: null,
      maxRetailPrice: null,
      retailPrice: "1250000",
      totalStock: "8",
      minLevel: "1",
      baseUnit: "cái",
    };
    const row = ProductMobileRow({
      product: product as never,
      selectionEnabled: true,
      selected: false,
      selectLabel: "Chọn Camera chọn hàng loạt",
      stockNotTrackedLabel: "Không theo dõi tồn",
      onToggle: () => calls.push("toggle:product-mobile-1"),
      onOpen: () => calls.push("open:product-mobile-1"),
    });
    const html = renderToStaticMarkup(row);
    const checkbox = elementsOfType(row, SelectionCheckbox)[0];
    const openButton = elementsOfType(row, "button")[0];

    expect(html).toContain('aria-label="Chọn Camera chọn hàng loạt"');
    expect(html).toContain("size-11");
    expect(html).not.toMatch(/class="[^"]*hidden[^"]*sm:block/);
    (checkbox.props.onChange as () => void)();
    (openButton.props.onClick as () => void)();

    const toolbar = ProductMobileSelectionToolbar({
      checked: false,
      indeterminate: true,
      selectedCount: 1,
      selectAllLabel: "Chọn tất cả sản phẩm đang hiển thị",
      selectedLabel: "Đã chọn 1",
      onToggleAll: () => calls.push("toggle-all"),
    });
    const toolbarHtml = renderToStaticMarkup(toolbar);
    const toolbarCheckbox = elementsOfType(toolbar, SelectionCheckbox)[0];
    (toolbarCheckbox.props.onChange as () => void)();

    expect(toolbarHtml).toContain("lg:hidden");
    expect(toolbarHtml).toContain("Đã chọn 1");
    expect(calls).toEqual([
      "toggle:product-mobile-1",
      "open:product-mobile-1",
      "toggle-all",
    ]);

    const productsPage = readFileSync(
      "src/app/(app)/inventory/tabs/products.tsx",
      "utf8",
    );
    const bulkActions = readFileSync(
      "src/app/(app)/inventory/tabs/product-selection.tsx",
      "utf8",
    );
    expect(productsPage).toContain("<ProductBulkActions />");
    expect(bulkActions).toContain("products.actions.stopSelling");
    expect(bulkActions).toContain("products.actions.delete");
    expect(bulkActions).not.toMatch(/ProductBulkActions[\s\S]*?hidden[^"]*sm:/);
  });

  test("order mobile selection and batch toolbar invoke selection and preserve form actions", async () => {
    const {
      OrderBatchToolbar,
      OrderMobileRow,
      OrderSelectionCheckbox,
    } = await import("@/app/(app)/sales/tabs/orders-table");
    const calls: string[] = [];
    const order = {
      id: "order-mobile-1",
      code: "HD-MOBILE-1",
      status: "completed",
      paymentStatus: "partial",
      createdAt: new Date("2026-07-29T08:00:00+07:00"),
      customerName: "Khách hàng mobile",
      sourceMode: "pos",
      total: "2500000",
      amountPaid: "1000000",
    };
    const row = OrderMobileRow({
      order: order as never,
      selected: false,
      onToggle: () => calls.push("toggle:order-mobile-1"),
      onOpen: () => calls.push("open:order-mobile-1"),
      labels: {
        walkIn: "Khách lẻ",
        remaining: "Còn nợ",
      },
    });
    const html = renderWithMessages(row);
    const checkbox = elementsOfType(row, OrderSelectionCheckbox)[0];
    const openButton = elementsOfType(row, "button")[0];

    expect(html).toContain('aria-label="HD-MOBILE-1"');
    expect(html).toContain("min-h-11");
    expect(html).not.toMatch(/class="[^"]*hidden[^"]*sm:block/);
    (checkbox.props.onChange as () => void)();
    (openButton.props.onClick as () => void)();

    const toolbar = OrderBatchToolbar({
      selectedCount: 2,
      allSelected: false,
      partiallySelected: true,
      onToggleAll: () => calls.push("toggle-all"),
      labels: {
        selectAll: "Chọn tất cả",
        hint: "Chọn đơn hàng loạt",
        merge: "Gộp đơn",
        print: "In đã chọn",
      },
    });
    const toolbarHtml = renderToStaticMarkup(toolbar);
    const toolbarCheckbox = elementsOfType(
      toolbar,
      OrderSelectionCheckbox,
    )[0];
    (toolbarCheckbox.props.onChange as () => void)();

    expect(toolbarHtml).toContain('formAction="/orders/merge"');
    expect(toolbarHtml).toContain('formAction="/orders/print-batch"');
    expect(toolbarHtml).toContain(">2<");
    expect(toolbarHtml).toContain("size-11");
    expect(toolbarHtml.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(calls).toEqual([
      "toggle:order-mobile-1",
      "open:order-mobile-1",
      "toggle-all",
    ]);
  });
});
