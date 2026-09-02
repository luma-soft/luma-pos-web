import { describe, expect, mock, setSystemTime, test } from "bun:test";
import { readFileSync } from "node:fs";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import Link from "next/link";
import viMessages from "../messages/vi.json";

const capturedDataTableProps: Record<string, unknown>[] = [];
const capturedProjectEditProps: Record<string, unknown>[] = [];
const stoppedRowToggleEvents: unknown[] = [];
const navigationCalls: string[] = [];
let productSelectedIds = new Set<string>();
let productVisibleIds: string[] = [];
const productSelectionCalls: string[] = [];

mock.module("@/components/data-table", () => ({
  DataTableShell: (props: Record<string, unknown>) => {
    capturedDataTableProps.push(props);
    return <div data-testid="captured-data-table" />;
  },
  RowPreviewModal: () => null,
  stopRowToggle: (event: unknown) => {
    stoppedRowToggleEvents.push(event);
  },
}));
mock.module("next/navigation", () => ({
  usePathname: () => "/test",
  useSearchParams: () => new URLSearchParams(),
  useRouter: () => ({
    push: (href: string) => navigationCalls.push(`push:${href}`),
    replace: (href: string) => navigationCalls.push(`replace:${href}`),
    refresh: () => navigationCalls.push("refresh"),
  }),
}));
mock.module(
  "@/app/(app)/inventory/tabs/product-selection",
  () => ({
    useProductSelection: () => {
      const selectedVisibleIds = productVisibleIds.filter((id) =>
        productSelectedIds.has(id),
      );
      return {
        selectedIds: productSelectedIds,
        selectedVisibleIds,
        allSelected:
          productVisibleIds.length > 0 &&
          selectedVisibleIds.length === productVisibleIds.length,
        toggle: (id: string) => {
          productSelectionCalls.push(`toggle:${id}`);
          const next = new Set(productSelectedIds);
          if (next.has(id)) next.delete(id);
          else next.add(id);
          productSelectedIds = next;
        },
        toggleAll: () => {
          productSelectionCalls.push("toggle-all");
          productSelectedIds =
            selectedVisibleIds.length === productVisibleIds.length
              ? new Set()
              : new Set(productVisibleIds);
        },
        replace: (ids: Set<string>) => {
          productSelectedIds = ids;
        },
      };
    },
    ProductBulkActions: () => null,
  }),
);
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
mock.module("@/lib/actions/orders", () => ({
  cancelOrders: async (ids: string[]) => ({
    ok: true,
    data: { cancelled: ids.length, failedIds: [] },
  }),
}));
mock.module("@/components/confirm-dialog-provider", () => ({
  useConfirmDialog: () => ({
    confirm: async () => true,
    alert: async () => undefined,
  }),
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
  createInstalledAssetsBatch: async () => ({ ok: true }),
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
    setSystemTime(new Date("2026-08-01T12:00:00+07:00"));
    let html: string;
    try {
      html = renderWithMessages(
        <PromotionMobileRow
        row={row}
        renderActions={(actionRow) => {
          actionCalls.push([actionRow.id, actionRow.isActive]);
          return <button type="button" className="min-h-11 min-w-11">Tạm dừng</button>;
        }}
      />,
      );
    } finally {
      setSystemTime();
    }

    expect(html).toContain("Giảm giá camera dự án");
    expect(html).toContain("Camera H6C Pro · cái");
    expect(html).toContain("≥5 cái → -3%");
    expect(html).toContain("≥10 cái → -5%");
    expect(html.match(/2026/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("→");
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

  test("service projects table opens the project modal route when its desktop row is clicked", async () => {
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
      orderCount: 1,
      totalValue: "120000",
      remaining: "100000",
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
    stoppedRowToggleEvents.length = 0;

    renderWithMessages(
      <ServiceProjectsTable rows={rows} customers={customers} />,
    );
    expect(capturedDataTableProps).toHaveLength(1);
    const tableProps = capturedDataTableProps[0];
    expect(tableProps.tableId).toBe("services.projects");
    expect(tableProps.rows).toBe(rows);
    expect(tableProps.onRowClick).toBeFunction();
    expect(tableProps.renderDetail).toBeUndefined();
    navigationCalls.length = 0;
    (tableProps.onRowClick as (row: typeof row) => void)(row);
    expect(navigationCalls).toEqual([
      "push:/projects/service-project-1",
    ]);
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
    expect(html).toContain('data-project-trade-icon="camera"');
    expect(html).toContain('lucide-camera');
    expect(html).not.toContain('data-project-stage-icon="active"');
    expect(html).toContain("Công ty Bình Minh");
    expect(html).not.toContain("65%");
    expect(html).not.toContain("2/5");
    expect(html).not.toContain("Lập kế hoạch");
    expect(html).toContain("4 thiết bị");
    expect(html).toContain("Quá hạn");
    expect(html).toContain("Xem chi tiết");
    expect(html).toContain('href="/projects/service-project-1"');
    expect(html).toMatch(
      /<h3[^>]*><a [^>]*href="\/projects\/service-project-1"[^>]*>Lắp camera nhà xưởng Bình Minh<\/a><\/h3>/,
    );
    expect(html).toContain("Sửa");
    expect(html.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(2);
    expect(html.startsWith("<article")).toBe(true);
    expect(capturedProjectEditProps).toHaveLength(1);
    expect(capturedProjectEditProps[0].project).toBe(row);
    expect(capturedProjectEditProps[0].customers).toBe(customers);

    const nameColumn = (
      tableProps.columns as Array<{
        key: string;
        render: (row: typeof row) => ReactNode;
      }>
    ).find((column) => column.key === "name");
    expect(nameColumn).toBeDefined();
    const desktopName = nameColumn!.render(row);
    const desktopNameHtml = renderToStaticMarkup(desktopName);
    expect(desktopNameHtml).toContain('data-project-trade-icon="camera"');
    expect(desktopNameHtml).toContain('lucide-camera');
    expect(desktopNameHtml).toMatch(
      /<a [^>]*href="\/projects\/service-project-1"[^>]*>Lắp camera nhà xưởng Bình Minh<\/a>/,
    );
    const statusColumn = (
      tableProps.columns as Array<{
        key: string;
        render: (row: typeof row) => ReactNode;
      }>
    ).find((column) => column.key === "status");
    expect(statusColumn).toBeDefined();
    const desktopStatusHtml = renderToStaticMarkup(statusColumn!.render(row));
    expect(desktopStatusHtml).toContain("Quá hạn");
    expect(desktopStatusHtml).not.toContain("Lập kế hoạch");
    expect(isValidElement(desktopName)).toBe(true);
    const desktopNameProps = elementsOfType(desktopName, Link)[0]?.props as {
      onClick?: (event: unknown) => void;
    };
    const clickEvent = { type: "click" };
    expect(desktopNameProps.onClick).toBeFunction();
    desktopNameProps.onClick!(clickEvent);
    expect(stoppedRowToggleEvents).toEqual([clickEvent]);
  });

  test("product unit selector renders alternate units and isolates row events", async () => {
    const {
      ProductUnitSelector,
    } = await import("@/app/(app)/inventory/tabs/products-table");
    const {
      Select,
    } = await import("@/components/ui/select");
    const changes: string[] = [];

    const single = ProductUnitSelector({
      productName: "Router",
      baseUnit: "cái",
      units: [],
      value: "cái",
      onChange: () => undefined,
    });
    expect(renderToStaticMarkup(single)).not.toContain("<select");
    expect(renderToStaticMarkup(single)).toContain("cái");

    const multi = ProductUnitSelector({
      productName: "Dây mạng",
      baseUnit: "m",
      units: [
        { unitName: "cuộn", multiplier: "305", priceOverride: null },
      ],
      value: "m",
      onChange: (unitName) => changes.push(unitName),
    });
    const multiHtml = renderWithMessages(multi);
    const select = elementsOfType(multi, Select)[0];

    expect(multiHtml).toContain('aria-label="Đơn vị tính Dây mạng"');
    expect(multiHtml).toContain('aria-haspopup="listbox"');
    expect(multiHtml).not.toContain("<select");
    expect(multiHtml).toContain(">m<");
    expect(select).toBeDefined();
    if (!select) return;
    expect(select.props.onClick).toBeUndefined();
    expect(
      (multi as React.ReactElement<{ className: string }>).props.className
        .split(/\s+/),
    ).not.toContain("w-full");
    expect(select.props.menuMinWidth).toBe(160);
    expect(select.props.wrapLabel).toBe(true);

    const clickEvent = { type: "click" };
    const pointerEvent = { type: "pointerdown" };
    const keyEvent = { type: "keydown" };
    stoppedRowToggleEvents.length = 0;
    const wrapper = multi as React.ReactElement<{
      onClick: (event: unknown) => void;
      onPointerDown: (event: unknown) => void;
      onKeyDown: (event: unknown) => void;
    }>;
    wrapper.props.onClick(clickEvent);
    wrapper.props.onPointerDown(pointerEvent);
    wrapper.props.onKeyDown(keyEvent);
    (select.props.onValueChange as (value: string) => void)("cuộn");

    expect(stoppedRowToggleEvents).toEqual([
      clickEvent,
      pointerEvent,
      keyEvent,
    ]);
    expect(changes).toEqual(["cuộn"]);
  });

  test("product unit columns render and sort by the selected unit", async () => {
    const {
      ProductUnitSelector,
      buildProductUnitColumns,
    } = await import("@/app/(app)/inventory/tabs/products-table");
    const changes: string[] = [];
    const cable = {
      id: "cable-1",
      name: "Dây mạng TAESUNG",
      categoryName: "Dây Mạng",
      productKind: "product",
      baseUnit: "m",
      costPrice: "3500",
      minCostPrice: "3500",
      maxCostPrice: "3500",
      retailPrice: "4400",
      minRetailPrice: "4400",
      maxRetailPrice: "4400",
      totalStock: "1000",
      reservedStock: "25",
      minLevel: "50",
      isVariantParent: false,
      unitDefinitions: [
        {
          unitName: "cuộn",
          multiplier: "500",
          priceOverride: "2100000",
        },
      ],
    };
    const columns = buildProductUnitColumns({
      labels: {
        units: "Đơn vị",
        cost: "Giá nhập",
        salePrice: "Giá bán",
        stock: "Tồn kho",
        stockNotTracked: "Không theo dõi tồn",
      },
      selectedUnitName: () => "cuộn",
      onUnitChange: (_product, unitName) => changes.push(unitName),
    });
    const column = (key: string) => columns.find((item) => item.key === key)!;

    const unitControl = column("units").render(cable as never);
    const select = elementsOfType(unitControl, ProductUnitSelector)[0];
    (
      select.props.onChange as (unitName: string) => void
    )("m");

    expect(changes).toEqual(["m"]);
    expect(renderToStaticMarkup(column("cost").render(cable as never)))
      .toContain("1.750.000");
    expect(renderToStaticMarkup(column("salePrice").render(cable as never)))
      .toContain("2.100.000");
    expect(renderToStaticMarkup(column("stock").render(cable as never)))
      .toContain("2 cuộn");
    expect(column("cost").sortValue?.(cable as never)).toBe(1_750_000);
    expect(column("salePrice").sortValue?.(cable as never)).toBe(2_100_000);
    expect(column("stock").sortValue?.(cable as never)).toBe(2);
  });

  test("product mobile row displays the selected unit without nesting controls", async () => {
    const {
      ProductMobileRow,
      ProductUnitSelector,
    } = await import("@/app/(app)/inventory/tabs/products-table");
    const calls: string[] = [];
    const cable = {
      id: "cable-mobile-1",
      name: "Dây điện thoại TAESUNG",
      sku: "506640",
      categoryName: "Điện",
      productKind: "product",
      imageUrls: [],
      minRetailPrice: "4400",
      maxRetailPrice: "4400",
      costPrice: "3500",
      retailPrice: "4400",
      totalStock: "1000",
      reservedStock: "25",
      minLevel: "50",
      baseUnit: "m",
      unitDefinitions: [
        {
          unitName: "cuộn",
          multiplier: "500",
          priceOverride: "2100000",
        },
      ],
    };
    const row = ProductMobileRow({
      product: cable as never,
      selectionEnabled: false,
      selected: false,
      selectLabel: "Chọn Dây điện thoại TAESUNG",
      stockNotTrackedLabel: "Không theo dõi tồn",
      selectedUnitName: "cuộn",
      onUnitChange: (unitName) => calls.push(`unit:${unitName}`),
      onToggle: () => calls.push("toggle"),
      onOpen: () => calls.push("open"),
    });
    const html = renderWithMessages(row);
    const openButton = elementsOfType(row, "button")[0];
    const rowSelector = elementsOfType(row, ProductUnitSelector)[0];

    expect(html).toContain("2.100.000");
    expect(html).toContain("2 cuộn");
    expect(elementsOfType(
      openButton.props.children as ReactNode,
      ProductUnitSelector,
    )).toHaveLength(0);
    (rowSelector.props.onChange as (unitName: string) => void)("m");

    expect(calls).toEqual(["unit:m"]);
  });

  test("product mobile row and select-all toolbar invoke the existing selection seams", async () => {
    const {
      ProductMobileRow,
      ProductMobileSelectionToolbar,
      ProductsTable,
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
      minRetailPrice: "999999999999",
      maxRetailPrice: "1999999999999",
      costPrice: "750000",
      retailPrice: "1250000",
      totalStock: "8",
      reservedStock: "0",
      minLevel: "1",
      baseUnit: "cái",
      isVariantParent: true,
      unitDefinitions: [],
    };
    const row = ProductMobileRow({
      product: product as never,
      selectionEnabled: true,
      selected: false,
      selectLabel: "Chọn Camera chọn hàng loạt",
      stockNotTrackedLabel: "Không theo dõi tồn",
      selectedUnitName: "cái",
      onUnitChange: (unitName) => calls.push(`unit:${unitName}`),
      onToggle: () => calls.push("toggle:product-mobile-1"),
      onOpen: () => calls.push("open:product-mobile-1"),
    });
    const html = renderToStaticMarkup(row);
    const checkbox = elementsOfType(row, SelectionCheckbox)[0];
    const openButton = elementsOfType(row, "button")[0];

    expect(html).toContain('aria-label="Chọn Camera chọn hàng loạt"');
    expect(html).toContain("size-11");
    expect(html).toContain("grid-cols-1");
    expect(html).toContain("break-words");
    expect(html).toContain("999.999.999.999");
    expect(html).toContain("1.999.999.999.999");
    expect(html).not.toContain("shrink-0 text-right");
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

    productSelectedIds = new Set();
    productVisibleIds = [product.id];
    productSelectionCalls.length = 0;
    capturedDataTableProps.length = 0;
    const actualHtml = renderWithMessages(
      <ProductsTable rows={[product] as never} />,
    );
    expect(actualHtml).toContain("Chọn tất cả sản phẩm đang hiển thị");
    expect(capturedDataTableProps).toHaveLength(1);
    const actualTable = capturedDataTableProps[0];
    expect(actualTable.renderMobileRow).toBeFunction();
    const actualMobileRow = (
      actualTable.renderMobileRow as (props: {
        row: typeof product;
        expanded: boolean;
        toggle: () => void;
      }) => ReactNode
    )({ row: product, expanded: false, toggle: () => undefined });
    const actualRowElement = actualMobileRow as React.ReactElement<
      Record<string, unknown>
    >;
    expect(actualRowElement.props.product).toBe(product);
    (actualRowElement.props.onToggle as () => void)();
    expect(productSelectedIds).toEqual(new Set(["product-mobile-1"]));
    expect(productSelectionCalls).toEqual(["toggle:product-mobile-1"]);
  });

  test("order mobile selection and batch toolbar invoke selection and preserve form actions", async () => {
    const {
      OrderBatchToolbar,
      OrderMobileRow,
      OrderSelectionCheckbox,
      OrdersTable,
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
      selectedIds: ["order-mobile-1", "order-mobile-2"],
      templates: [],
      cancelling: false,
      onCancel: () => calls.push("cancel:selected-orders"),
      labels: {
        merge: "Gộp đơn",
        print: "In đã chọn",
        cancel: "Hủy đã chọn",
      },
    });
    const toolbarHtml = renderToStaticMarkup(toolbar);
    const toolbarButtons = elementsOfType(toolbar, "button");
    const cancelButton = toolbarButtons.find(
      (button) => button.props["aria-label"] === "Hủy đã chọn",
    );

    expect(toolbarHtml).toContain('formAction="/orders/merge"');
    expect(toolbarHtml).toContain("In đã chọn");
    expect(toolbarHtml).toContain("Hủy đã chọn");
    expect(toolbarHtml).toContain(">2<");
    expect(toolbarHtml.match(/min-h-11/g)?.length).toBeGreaterThanOrEqual(3);
    expect(toolbarHtml).toContain("justify-end");
    expect(toolbarHtml).not.toContain("Tick chọn nhiều đơn để in cùng lúc");
    expect(cancelButton?.props.type).toBe("button");
    (cancelButton?.props.onClick as () => void)();
    expect(calls).toEqual([
      "toggle:order-mobile-1",
      "open:order-mobile-1",
      "cancel:selected-orders",
    ]);

    const manyOrders = Array.from({ length: 31 }, (_, index) => ({
      ...order,
      id: `order-${index + 1}`,
      code: `HD-${String(index + 1).padStart(3, "0")}`,
      status: index === 30 ? "cancelled" : "completed",
    }));
    let executedSelection = new Set<string>();
    const renderActualOrders = () => {
      capturedDataTableProps.length = 0;
      const actualHtml = renderWithMessages(
        <OrdersTable
          rows={manyOrders as never}
          selection={{
            selectedIds: executedSelection,
            onChange: (next) => {
              executedSelection = next;
            },
          }}
        />,
      );
      expect(capturedDataTableProps).toHaveLength(1);
      return {
        actualHtml,
        table: capturedDataTableProps[0],
      };
    };

    const targetOrderIds = manyOrders
      .slice(0, 30)
      .map((item) => item.id);
    executedSelection = new Set(
      manyOrders
        .slice(10, 30)
        .map((item) => item.id),
    );
    const mismatchedActual = renderActualOrders();
    const selectionColumn = (
      mismatchedActual.table.columns as Array<Record<string, unknown>>
    )[0];
    const desktopMaster = selectionColumn.label as React.ReactElement<
      Record<string, unknown>
    >;
    expect(desktopMaster.props.checked).toBe(false);
    expect(desktopMaster.props.indeterminate).toBe(true);
    (desktopMaster.props.onChange as () => void)();
    expect([...executedSelection]).toEqual(targetOrderIds);

    const replacedActual = renderActualOrders();
    expect(replacedActual.actualHtml.match(/name="ids"/g)).toHaveLength(
      30,
    );
    expect(
      [...replacedActual.actualHtml.matchAll(/name="ids" value="([^"]+)"/g)]
        .map((match) => match[1]),
    ).toEqual(targetOrderIds);
    const replacedToolbar = replacedActual.table.toolbar as React.ReactElement<
      Record<string, unknown>
    >;
    expect(replacedToolbar.props.selectedCount).toBe(30);
    const replacedSelectionColumn = (
      replacedActual.table.columns as Array<Record<string, unknown>>
    )[0];
    expect(
      (replacedSelectionColumn.label as React.ReactElement<Record<string, unknown>>).props.checked,
    ).toBe(true);

    executedSelection = new Set();
    const initialActual = renderActualOrders();
    expect(initialActual.table.renderMobileRow).toBeFunction();
    const initialSelectionColumn = (
      initialActual.table.columns as Array<Record<string, unknown>>
    )[0];
    const initialDesktopMaster = initialSelectionColumn.label as React.ReactElement<
      Record<string, unknown>
    >;
    (initialDesktopMaster.props.onChange as () => void)();
    expect(executedSelection.size).toBe(30);
    expect([...executedSelection]).toEqual(
      manyOrders.slice(0, 30).map((item) => item.id),
    );

    const allSelectedActual = renderActualOrders();
    expect(
      allSelectedActual.actualHtml.match(/name="ids"/g),
    ).toHaveLength(30);
    const allSelectedToolbar = allSelectedActual.table.toolbar as React.ReactElement<
      Record<string, unknown>
    >;
    expect(allSelectedToolbar.props.selectedCount).toBe(30);
    const allSelectedToolbarHtml = renderToStaticMarkup(allSelectedToolbar);
    expect(allSelectedToolbarHtml).not.toContain("Tick chọn nhiều đơn để in cùng lúc");

    const actualRenderer = allSelectedActual.table.renderMobileRow as (props: {
      row: typeof order;
      expanded: boolean;
      toggle: () => void;
    }) => ReactNode;
    const twentyFirst = actualRenderer({
      row: manyOrders[20],
      expanded: false,
      toggle: () => undefined,
    }) as React.ReactElement<Record<string, unknown>>;
    expect(twentyFirst.props.order).toBe(manyOrders[20]);
    (twentyFirst.props.onToggle as () => void)();
    expect(executedSelection.size).toBe(29);
    expect(executedSelection.has("order-21")).toBe(false);

    const cancelled = actualRenderer({
      row: manyOrders[30],
      expanded: false,
      toggle: () => undefined,
    }) as React.ReactElement<Record<string, unknown>>;
    (cancelled.props.onToggle as () => void)();
    expect(executedSelection.has("order-31")).toBe(false);
    expect(renderWithMessages(cancelled)).toContain("disabled");
  });
});
