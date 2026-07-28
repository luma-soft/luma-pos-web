import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import viMessages from "../messages/vi.json";
import enMessages from "../messages/en.json";
import { ProjectServiceTab, ProjectServiceTabs } from "@/app/(app)/projects/[id]/project-service-tabs";
import { NotificationMobileRow } from "@/app/(app)/notifications/notifications-table";

function renderWithMessages(node: React.ReactNode, locale: "vi" | "en" = "vi") {
  return renderToStaticMarkup(
    <NextIntlClientProvider
      locale={locale}
      messages={locale === "vi" ? viMessages : enMessages}
      timeZone="Asia/Ho_Chi_Minh"
    >
      {node}
    </NextIntlClientProvider>,
  );
}

describe("project service mobile records", () => {
  test("service tab carousel exposes selected state, snap alignment, focus, and 44px targets", () => {
    const html = renderToStaticMarkup(
      <ProjectServiceTabs initialActive="overview">
        <ProjectServiceTab id="overview" label="Overview">Overview content</ProjectServiceTab>
        <ProjectServiceTab id="assets" label="Assets">Assets content</ProjectServiceTab>
      </ProjectServiceTabs>,
    );

    expect(html).toContain('role="tablist"');
    expect(html).toContain("snap-x");
    expect(html.match(/role="tab"/g)).toHaveLength(2);
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain('aria-selected="false"');
    expect(html.match(/class="(?=[^"]*min-h-11)(?=[^"]*snap-start)(?=[^"]*focus-visible:ring-2)[^"]*"/g)).toHaveLength(2);
  });

  test("every scoped project record has a mobile renderer and a desktop-only presentation", () => {
    const source = readFileSync("src/app/(app)/projects/[id]/page.tsx", "utf8");

    for (const kind of ["maintenance", "cost", "asset", "warranty", "material", "order"]) {
      expect(source).toContain(`data-mobile-record="${kind}"`);
    }
    expect(source.match(/data-mobile-record="(?:maintenance|cost|asset|warranty|material|order)"/g)).toHaveLength(6);
    expect(source.match(/className="hidden[^"]*lg:block"/g)?.length).toBeGreaterThanOrEqual(6);
  });
});

describe("notification mobile records", () => {
  test("mobile renderer opens the existing detail flow without exposing raw audit data", () => {
    const secret = "sk-this-secret-must-never-render";
    const html = renderWithMessages(
      <NotificationMobileRow
        row={{
          id: "audit-1",
          actorId: null,
          actorNameSnapshot: null,
          source: "ai",
          action: "create_order",
          entityType: "order",
          entityId: "order-1",
          status: "failed",
          prompt: `Please use ${secret}`,
          parsedIntent: null,
          before: { token: secret },
          after: null,
          affectedRecords: [{ type: "order", id: "order-1", code: "HD0001" }],
          metadata: { authorization: secret },
          createdAt: new Date("2026-07-28T08:00:00+07:00"),
        }}
        expanded={false}
        toggle={() => undefined}
      />,
    );

    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("min-h-11");
    expect(html).toContain("Thất bại");
    expect(html).toContain("Hệ thống");
    expect(html).toContain("sk-[redacted]");
    expect(html).not.toContain(secret);
    expect(html).not.toContain("&quot;before&quot;");
    expect(html).not.toContain("&quot;metadata&quot;");

    const source = readFileSync("src/app/(app)/notifications/notifications-table.tsx", "utf8");
    expect(source.match(/renderMobileRow=/g)).toHaveLength(1);
    expect(source.match(/renderDetail=/g)).toHaveLength(1);
    expect(source).toContain("renderDetail={(row) => <ExpandedAudit row={row} />}");
    expect(source.match(/<ExpandedAudit /g)).toHaveLength(1);
  });

  test("notification labels and every status are paired in Vietnamese and English", () => {
    const vi = viMessages.notifications;
    const en = enMessages.notifications;
    const statuses = ["previewed", "confirmed", "succeeded", "failed", "cancelled", "unauthorized"] as const;

    expect(vi.title).toBe("Thông báo");
    expect(en.title).toBe("Notifications");
    expect(vi.subtitle).not.toBe(en.subtitle);
    expect(vi.filters).not.toBe(en.filters);
    expect(vi.allSources).not.toBe(en.allSources);
    expect(vi.allStatuses).not.toBe(en.allStatuses);
    for (const status of statuses) {
      expect(vi.statuses[status]).toBeTruthy();
      expect(en.statuses[status]).toBeTruthy();
      expect(vi.statuses[status]).not.toBe(en.statuses[status]);
    }
  });
});
