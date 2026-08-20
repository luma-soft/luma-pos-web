import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  PathnameContext,
  SearchParamsContext,
} from "next/dist/shared/lib/hooks-client-context.shared-runtime.js";
import viMessages from "../messages/vi.json";
import { GroupTabs } from "@/components/group-tabs";
import {
  ReportCustomerMobileRow,
  ReportProductMobileRow,
} from "@/app/(app)/reports/report-detail-tables";
import { ReportInvoiceMobileRow } from "@/app/(app)/reports/report-invoices-table";
import { ReportPeriodChips } from "@/app/(app)/reports/report-period-filter";

function renderWithMessages(node: React.ReactNode) {
  return renderToStaticMarkup(
    <PathnameContext.Provider value="/reports">
      <SearchParamsContext.Provider value={new URLSearchParams()}>
        <NextIntlClientProvider locale="vi" messages={viMessages} timeZone="Asia/Ho_Chi_Minh">
          {node}
        </NextIntlClientProvider>
      </SearchParamsContext.Provider>
    </PathnameContext.Provider>,
  );
}

describe("mobile report rows", () => {
  test("product row keeps quantity, revenue, and signed profit readable", () => {
    const productName = "Camera H6C Pro 2K với tên sản phẩm rất dài cần hiển thị đầy đủ trên nhiều dòng";
    const html = renderWithMessages(
      <ReportProductMobileRow
        row={{
          productId: "product-1",
          productName,
          qtySold: 12,
          qtyReturned: 0,
          baseUnit: "cái",
          imageUrls: [],
          revenue: 12500000,
          cost: 12850000,
          profit: -350000,
          margin: -2.8,
          returnCount: 0,
          contribution: 100,
        }}
      />,
    );

    expect(html).toContain(`<div class="break-words text-sm font-black leading-snug">${productName}</div>`);
    expect(html).toContain("12 cái");
    expect(html).toContain("12.500.000");
    expect(html).toContain("350.000");
    expect(html).toContain("text-er");
    expect(html).toContain("<dt");
    expect(html).toContain("<dd");
  });

  test("customer row preserves its report dimensions", () => {
    const customerName = "Công ty TNHH Thiết bị An ninh Nguyễn An Chi nhánh Trung tâm";
    const customerHtml = renderWithMessages(
      <ReportCustomerMobileRow
        row={{
          customerId: "customer-1",
          customerName,
          customerType: "retail",
          orderCount: 4,
          customerCreatedAt: new Date("2026-07-01"),
          revenue: 4200000,
          remaining: "500000",
          lastPurchaseAt: new Date("2026-07-28"),
          profit: 900000,
          margin: 21.4,
          averageOrder: 1050000,
          segment: "returning",
        }}
      />,
    );

    expect(customerHtml).toContain(`<div class="break-words text-sm font-black leading-snug">${customerName}</div>`);
    expect(customerHtml).toContain("500.000");
    expect(customerHtml).toContain("text-er");
  });

  test("invoice row exposes a 44px order link and all financial values", () => {
    const html = renderWithMessages(
      <ReportInvoiceMobileRow
        row={{
          id: "order-1",
          code: "HD0001",
          status: "completed",
          createdAt: new Date("2026-07-28T08:00:00+07:00"),
          customerName: "Khách lẻ",
          total: 1500000,
          amountPaid: "1200000",
          cost: 1200000,
          profit: 300000,
          refund: 0,
          margin: 20,
        }}
      />,
    );

    expect(html).toContain("HD0001");
    expect(html).toContain("min-h-11");
    expect(html).toContain("1.500.000");
    expect(html).toContain("1.200.000");
    expect(html).toContain("300.000");
    expect(html).toContain("text-ok");
  });
});

describe("mobile report controls", () => {
  test("period chips expose the four approved mobile ranges", () => {
    const html = renderWithMessages(
      <ReportPeriodChips period="this_month" onSelect={() => undefined} />,
    );
    expect(html).toContain('aria-label="Khoảng thời gian"');
    expect(html).toContain("Hôm nay");
    expect(html).toContain("Tháng này");
    expect(html.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(4);
    expect(html.match(/aria-pressed="(?:true|false)"[^>]*class="[^"]*min-h-11[^"]*"/g)).toHaveLength(4);
  });

  test("report mobile tabs opt into 44px links while retaining desktop density", () => {
    const html = renderWithMessages(
      <GroupTabs
        base="/reports"
        items={[
          { tab: "overview", labelKey: "reports.overview" },
          { tab: "invoices", labelKey: "reports.invoices" },
        ]}
        linkClassName="h-11"
      />,
    );

    expect(html.match(/<a [^>]*class="(?=[^"]*h-11)(?=[^"]*lg:h-9)[^"]*"/g)).toHaveLength(2);
  });

  test("group tabs expose a non-interactive mobile overflow cue", () => {
    const html = renderWithMessages(
      <GroupTabs
        base="/reports"
        items={[
          { tab: "overview", labelKey: "reports.overview" },
          { tab: "invoices", labelKey: "reports.invoices" },
        ]}
      />,
    );

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain("pointer-events-none");
    expect(html).toContain("bg-gradient-to-l");
    expect(html).toContain("lg:hidden");
  });

  test("group tabs reject arbitrary pre-lg geometry overrides while preserving lg customization", () => {
    const html = renderWithMessages(
      <GroupTabs
        base="/reports"
        items={[
          { tab: "overview", labelKey: "reports.overview" },
          { tab: "invoices", labelKey: "reports.invoices" },
        ]}
        linkClassName="h-8 w-8 sm:h-8 sm:w-8 md:h-8 md:w-8 lg:h-10 lg:w-auto"
      />,
    );
    const classes = [...html.matchAll(/<a [^>]*class="([^"]*)"/g)].map(
      (match) => match[1].split(/\s+/),
    );

    expect(classes).toHaveLength(2);
    for (const tokens of classes) {
      expect(tokens).toEqual(
        expect.arrayContaining([
          "h-11",
          "min-w-11",
          "sm:h-11",
          "sm:min-w-11",
          "md:h-11",
          "md:min-w-11",
          "lg:h-10",
          "lg:w-auto",
        ]),
      );
      expect(tokens).not.toEqual(
        expect.arrayContaining([
          "h-8",
          "w-8",
          "sm:h-8",
          "sm:w-8",
          "md:h-8",
          "md:w-8",
        ]),
      );
    }
  });

  test("page separates mobile and desktop headers and keeps chart metrics accessible", () => {
    const source = readFileSync("src/app/(app)/reports/page.tsx", "utf8");

    expect(source).toMatch(/<MobileTopBar[\s\S]*?title=\{t\("reports\.title"\)\}/);
    expect(source).toMatch(/className="[^"]*hidden[^"]*lg:block[^"]*"[\s\S]*?<GroupTabs/);
    expect(source).toContain("edgeToEdge");
    expect(source).toContain("OverviewReport");
    expect(source).toContain("OrdersReport");
    expect(source).toContain("ProductsReport");
    expect(source).toContain("CustomersReport");
  });

  test("custom date fields retain 44px mobile touch targets", () => {
    const source = readFileSync("src/app/(app)/reports/report-period-filter.tsx", "utf8");
    const dateInputs = source.match(/type="date"[\s\S]{0,260}?className="[^"]*h-11[^"]*"/g) ?? [];

    expect(dateInputs).toHaveLength(2);
  });

  test("reports default to today and the desktop period picker keeps full labels readable", () => {
    const pageSource = readFileSync("src/app/(app)/reports/page.tsx", "utf8");
    const filterSource = readFileSync("src/app/(app)/reports/report-period-filter.tsx", "utf8");
    const mobileRouteSource = readFileSync("src/app/api/mobile/reports/route.ts", "utf8");

    expect(pageSource).toMatch(/requestedPeriod[\s\S]{0,180}: "today";/);
    expect(mobileRouteSource).toContain('searchParam(request, "range", "today")');
    expect(filterSource).toContain('rootClassName="w-56"');
    expect(filterSource).toContain("menuMinWidth={224}");
  });
});
