import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const read = (path: string) => readFileSync(path, "utf8");

describe("simple project experience", () => {
  test("uses the focused overview, device and media experience", () => {
    const detailView = read("src/app/(app)/projects/[id]/project-detail-view.tsx");
    const simpleView = read("src/app/(app)/projects/[id]/project-simple-experience.tsx");

    expect(detailView).toContain("ProjectSimpleExperience");
    expect(simpleView).toContain('id="overview"');
    expect(simpleView).toContain('id="devices"');
    expect(simpleView).toContain('id="media"');
    expect(simpleView).toContain("Danh sách ghi chú");
    expect(simpleView).not.toContain('label="Thi công"');
    expect(simpleView).not.toContain('label="Tài chính & hồ sơ"');
  });

  test("removes planning badges from project list rows", () => {
    const source = read("src/app/(app)/services/service-widgets.tsx");
    const mobileRow = source.slice(
      source.indexOf("export function ServiceProjectMobileRow"),
      source.indexOf("export function ServiceProjectsTable"),
    );

    expect(mobileRow).not.toContain("ProjectStageBadge");
    expect(mobileRow).not.toContain("progressPercent");
    expect(mobileRow).toContain("assetCount");

    const filters = source.slice(
      source.indexOf("export function ServiceDashboardFilters"),
      source.indexOf("export function ServiceProjectMobileRow"),
    );
    expect(filters).toContain('tab !== "projects"');
  });

  test("keeps the web service navigation focused on projects", () => {
    const page = read("src/app/(app)/services/page.tsx");

    expect(page).not.toContain("<GroupTabs");
    expect(page).not.toContain('project.serviceStage === status');
  });

  test("provides a dedicated notes page and route", () => {
    expect(read("src/lib/routes.ts")).toContain("projectNotes:");
    expect(read("src/app/(app)/projects/[id]/notes/page.tsx")).toContain("ProjectNotesClient");
    const client = read("src/app/(app)/projects/[id]/notes/project-notes-client.tsx");
    expect(client).toContain("Thêm ghi chú");
    expect(client).toContain("Sửa ghi chú");
    expect(client).toContain("Xóa ghi chú");
  });
});
