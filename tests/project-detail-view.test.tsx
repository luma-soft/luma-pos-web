import { describe, expect, mock, test } from "bun:test";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import viMessages from "../messages/vi.json";
import type { ProjectDetail } from "@/lib/data/projects";

process.env.DATABASE_URL ??= "postgres://test:test@127.0.0.1:5432/test";

mock.module("next-intl/server", () => ({
  getTranslations: async () => createTranslator({ locale: "vi", messages: viMessages }),
}));

mock.module("next/navigation", () => ({
  usePathname: () => "/projects/project-1",
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

const detail = {
  project: {
    id: "project-1",
    name: "Công trình Riverside",
    customerId: "customer-1",
    address: "12 Nguyễn Huệ",
    note: "Giao giờ hành chính",
    status: "active",
    serviceType: null,
    serviceStage: null,
    progressPercent: 0,
    startsOn: null,
    targetEndsOn: null,
    siteContactName: null,
    siteContactPhone: null,
    customerName: "Nguyễn An",
    orderCount: 1,
    totalValue: "1250000",
    remaining: "250000",
    createdAt: new Date("2026-07-20T02:00:00.000Z"),
  },
  orders: [
    {
      id: "order-1",
      code: "HD0001",
      status: "completed",
      paymentStatus: "partial",
      total: "1250000",
      amountPaid: "1000000",
      createdAt: new Date("2026-07-21T02:00:00.000Z"),
      customerName: "Nguyễn An",
      projectName: "Công trình Riverside",
    },
  ],
  jobs: [],
  assets: [],
  claims: [],
  materials: [],
  statusLogs: [],
  costEntries: [],
  profitability: {
    revenue: 1_250_000,
    materialCost: 0,
    laborCost: 0,
    otherCost: 0,
    totalCost: 0,
    grossProfit: 1_250_000,
    marginPercent: 100,
  },
  plannedMaterialCost: 0,
  handoverDocuments: [],
  maintenancePlans: [],
} satisfies ProjectDetail;

async function renderProjectDetail(presentation: "page" | "modal") {
  const { ProjectDetailView } = await import(
    "@/app/(app)/projects/[id]/project-detail-view"
  );
  const view = await ProjectDetailView({
    detail,
    serviceOptions: null,
    presentation,
  });

  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale="vi"
      messages={viMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {view}
    </NextIntlClientProvider>,
  );
}

function expectSharedDetailContent(html: string) {
  expect(html).toContain("Số đơn");
  expect(html).toContain("Giá trị vật tư");
  expect(html).toContain("Còn nợ");
  expect(html).toContain("Trạng thái");
  expect(html).toContain("1.250.000");
  expect(html).toContain("250.000");
  expect(html).toContain("Đang chạy");
  expect(html).toContain("Đơn / báo giá liên quan");
  expect(html).toContain("HD0001");
}

describe("ProjectDetailView", () => {
  test("renders project actions as two separated buttons in the modal toolbar", async () => {
    const { ProjectDetailActions } = await import(
      "@/app/(app)/projects/[id]/project-detail-view"
    );
    const html = renderToStaticMarkup(
      <NextIntlClientProvider
        locale="vi"
        messages={viMessages}
        timeZone="Asia/Ho_Chi_Minh"
      >
        <ProjectDetailActions
          project={{ ...detail.project, serviceType: "camera" }}
          serviceOptions={{
            customerOptions: [],
            projectOptions: [],
            assigneeOptions: [],
            jobOptions: [],
            assetOptions: [],
            warehouseOptions: [],
          }}
        />
      </NextIntlClientProvider>,
    );

    expect(html).toContain('data-project-detail-actions="true"');
    expect(html).toContain("flex-wrap items-center justify-end gap-2");
    expect(html).toMatch(
      /<button[^>]*class="[^"]*border-border[^"]*"[^>]*>Sửa<\/button>/,
    );
    expect(html).toContain("Tạo báo giá");
  });

  test("shares project metrics and related orders while keeping page navigation out of the modal", async () => {
    const pageHtml = await renderProjectDetail("page");
    const modalHtml = await renderProjectDetail("modal");

    expect(pageHtml).toContain("Công trình Riverside");
    expect(pageHtml).toContain("<header");
    expect(pageHtml).toContain('href="/services?tab=projects"');
    expectSharedDetailContent(pageHtml);

    expectSharedDetailContent(modalHtml);
    expect(modalHtml).not.toContain("<header");
    expect(modalHtml).not.toContain('href="/services?tab=projects"');
    expect(modalHtml).toContain("flex justify-end px-4 py-4 sm:px-6");
  });
});
