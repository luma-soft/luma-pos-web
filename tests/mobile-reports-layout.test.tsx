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
  ReportEmployeeMobileRow,
  ReportProductMobileRow,
} from "@/app/(app)/reports/report-detail-tables";
import { ReportInvoiceMobileRow } from "@/app/(app)/reports/report-invoices-table";
import { ReportPeriodDisclosure } from "@/app/(app)/reports/report-period-filter";

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
          qtySold: "12",
          baseUnit: "cái",
          revenue: "12500000",
          profit: "-350000",
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

  test("customer and employee rows preserve their report dimensions", () => {
    const customerName = "Công ty TNHH Thiết bị An ninh Nguyễn An Chi nhánh Trung tâm";
    const employeeName = "Trần Bình Nhân viên tư vấn dự án khu vực phía Nam";
    const customerHtml = renderWithMessages(
      <ReportCustomerMobileRow
        row={{
          customerId: "customer-1",
          customerName,
          customerType: "retail",
          orderCount: 4,
          revenue: "4200000",
          remaining: "500000",
        }}
      />,
    );
    const employeeHtml = renderWithMessages(
      <ReportEmployeeMobileRow
        row={{
          sellerId: "employee-1",
          sellerName: employeeName,
          orderCount: 6,
          revenue: "7200000",
          collected: "6800000",
        }}
      />,
    );

    expect(customerHtml).toContain(`<div class="break-words text-sm font-black leading-snug">${customerName}</div>`);
    expect(customerHtml).toContain("500.000");
    expect(customerHtml).toContain("text-er");
    expect(employeeHtml).toContain(`<div class="break-words text-sm font-black leading-snug">${employeeName}</div>`);
    expect(employeeHtml).toContain("6.800.000");
    expect(employeeHtml).toContain("text-ok");
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
          total: "1500000",
          amountPaid: "1200000",
          profit: "300000",
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
  test("period disclosure stays compact until expanded", () => {
    const collapsed = renderWithMessages(
      <ReportPeriodDisclosure period="30d" open={false} onToggle={() => undefined} onSelect={() => undefined} />,
    );
    const expanded = renderWithMessages(
      <ReportPeriodDisclosure period="30d" open onToggle={() => undefined} onSelect={() => undefined} />,
    );

    expect(collapsed).toContain('aria-expanded="false"');
    expect(collapsed).toContain("30 ngày gần nhất");
    expect(collapsed).not.toContain('aria-label="Khoảng thời gian"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(expanded.match(/aria-pressed="(?:true|false)"/g)).toHaveLength(7);
    expect(expanded.match(/aria-pressed="(?:true|false)"[^>]*class="[^"]*min-h-11[^"]*"/g)).toHaveLength(7);
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

  test("page separates mobile and desktop headers and keeps chart metrics accessible", () => {
    const source = readFileSync("src/app/(app)/reports/page.tsx", "utf8");

    expect(source).toMatch(/<MobileTopBar[\s\S]*?title=\{t\("reports\.title"\)\}/);
    expect(source).toMatch(/className="[^"]*hidden[^"]*lg:block[^"]*"[\s\S]*?<GroupTabs/);
    expect(source).toContain("edgeToEdge");
    expect(source).toContain("text-[clamp(1rem,5vw,1.35rem)]");
    expect(source).toContain("min-w-8");
    expect(source).toMatch(/aria-label=\{`\$\{d\.day\}[^`]*formatCurrency\(v\)/);
  });

  test("custom date fields retain 44px mobile touch targets", () => {
    const source = readFileSync("src/app/(app)/reports/report-period-filter.tsx", "utf8");
    const dateInputs = source.match(/type="date"[\s\S]{0,260}?className="[^"]*h-11[^"]*"/g) ?? [];

    expect(dateInputs).toHaveLength(2);
  });
});
