import { describe, expect, mock, test } from "bun:test";
import { Children, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "../messages/vi.json";

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
  ProjectEdit: () => null,
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

  test("service project row preserves table parity and its editor seam", async () => {
    const { ServiceProjectMobileRow } = await import(
      "@/app/(app)/services/service-widgets"
    );
    const actionCalls: unknown[][] = [];
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
    const html = renderWithMessages(
      <ServiceProjectMobileRow
        row={row}
        renderActions={(actionRow) => {
          actionCalls.push([actionRow.id, actionRow.serviceStage]);
          return <button type="button" className="min-h-11 min-w-11">Sửa</button>;
        }}
      />,
    );

    expect(html).toContain("Lắp camera nhà xưởng Bình Minh");
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
    expect(actionCalls).toEqual([["service-project-1", "active"]]);
    expect(html.startsWith("<article")).toBe(true);
  });
});
