import { describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextIntlClientProvider, createTranslator } from "next-intl";
import { renderToStaticMarkup } from "react-dom/server";
import enMessages from "../messages/en.json";
import viMessages from "../messages/vi.json";
import type { ProjectDetail } from "@/lib/data/projects";

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

mock.module("@/components/product-catalog-provider", () => ({
  useProductCatalog: () => ({
    products: [],
    snapshot: null,
    status: "synced",
    refresh: async () => undefined,
    search: () => [],
  }),
}));

mock.module("@/components/confirm-dialog-provider", () => ({
  useConfirmDialog: () => ({ confirm: async () => true }),
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
  dependencies: [],
  coordinationPoints: [],
} satisfies ProjectDetail;

async function importProjectDetailView() {
  const previousDatabaseUrl = process.env.DATABASE_URL;
  process.env.DATABASE_URL = "postgres://test:test@127.0.0.1:5432/test";
  try {
    return await import("@/app/(app)/projects/[id]/project-detail-view");
  } finally {
    if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabaseUrl;
  }
}

async function renderProjectDetail(presentation: "page" | "modal") {
  const { ProjectDetailView } = await importProjectDetailView();
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

async function renderServiceProjectDetail() {
  const { ProjectDetailView } = await importProjectDetailView();
  const view = await ProjectDetailView({
    detail: {
      ...detail,
      assets: [
        {
          id: "asset-1",
          jobId: null,
          productId: null,
          assetKind: "camera",
          name: "Camera sảnh chính",
          brand: "EZVIZ",
          model: "H6C",
          serialNumber: "SN-001",
          macAddress: null,
          ipAddress: null,
          locationLabel: "Sảnh chính",
          installedAt: new Date("2026-07-24T02:00:00.000Z"),
          createdAt: new Date("2026-07-24T02:00:00.000Z"),
          customerWarrantyEndsOn: null,
          supplierWarrantyEndsOn: null,
          status: "installed",
          note: null,
          specs: {},
          cameraVaultId: null,
          cameraAccessConfigured: false,
          cameraAccessRotatedAt: null,
        },
      ],
      statusLogs: [
        {
          id: "status-1",
          jobId: "job-1",
          fromStatus: "in_progress",
          toStatus: "completed",
          note: "Nghiệm thu hoàn tất",
          createdByName: "Mai Site",
          createdAt: new Date("2026-07-25T02:00:00.000Z"),
        },
      ],
      project: {
        ...detail.project,
        serviceType: "camera",
        serviceStage: "active",
      },
    },
    serviceOptions: {
      customerOptions: [],
      projectOptions: [],
      assigneeOptions: [],
      jobOptions: [],
      assetOptions: [],
      warehouseOptions: [],
    },
    presentation: "page",
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
  test("provides the material product label in every supported locale", () => {
    expect(createTranslator({ locale: "vi", messages: viMessages })("services.materials.product")).toBe("Sản phẩm");
    expect(createTranslator({ locale: "en", messages: enMessages })("services.materials.product")).toBe("Product");
  });

  test("renders project actions as two separated buttons in the modal toolbar", async () => {
    const { ProjectDetailActions } = await importProjectDetailView();
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
          t={createTranslator({ locale: "vi", messages: viMessages })}
        />
      </NextIntlClientProvider>,
    );

    expect(html).toContain('data-project-detail-actions="true"');
    expect(html).toContain("flex-wrap items-center justify-end gap-2");
    expect(html).toMatch(
      /<button[^>]*class="[^"]*border-border[^"]*"[^>]*>Sửa<\/button>/,
    );
    expect(html).toMatch(
      /<a[^>]*class="[^"]*h-11[^"]*text-xs[^"]*lg:h-8[^"]*"[^>]*>Tạo báo giá<\/a>/,
    );
  });

  test("renders semantic icons for every redesigned project flow tab", async () => {
    const html = await renderServiceProjectDetail();

    for (const id of ["overview", "execution", "devices", "aftercare", "finance"]) {
      expect(html).toContain(`data-project-tab-icon="${id}"`);
    }
    expect(html).toContain('class="lucide lucide-house"');
    expect(html).toContain('class="lucide lucide-wrench"');
    expect(html).toContain('class="lucide lucide-camera"');
    expect(html).toContain('class="lucide lucide-clipboard-check"');
    expect(html).toContain('class="lucide lucide-file-text"');
  });

  test("renders semantic metric and activity icons in the project overview", async () => {
    const html = await renderServiceProjectDetail();

    for (const id of ["progress", "devices", "jobs", "warranty"]) {
      expect(html).toContain(`data-project-pulse-icon="${id}"`);
    }
    expect(html).toContain('lucide-server');
    expect(html).toContain('lucide-clipboard-list');
    expect(html).toContain('data-project-activity-icon="status"');
    expect(html).toContain('data-project-activity-icon="asset"');
    expect(html).toContain('lucide-shield-check');
    expect(html).toContain('lucide-camera');
  });

  test("renders semantic section icons throughout the camera access vault", async () => {
    const html = await renderServiceProjectDetail();

    for (const id of ["connection", "secrets", "viewers", "history"]) {
      expect(html).toContain(`data-camera-vault-section="${id}"`);
    }
    expect(html).toContain('lucide-earth');
    expect(html).toContain('lucide-lock-keyhole');
    expect(html).toContain('lucide-users');
    expect(html).toContain('lucide-history');
    expect(html.match(/data-camera-secret-visibility="hidden"/g)).toHaveLength(6);
  });

  test("keeps mixed-project dependency and coordination icons explicit", () => {
    const source = readFileSync(
      "src/app/(app)/projects/[id]/project-redesigned-experience.tsx",
      "utf8",
    );

    expect(source).toContain('data-project-coordination-icon="dependency"');
    expect(source).toContain('data-project-coordination-icon="point"');
    expect(source).toContain('<Link2');
    expect(source).toContain('<MapPin');
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
