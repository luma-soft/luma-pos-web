import { describe, expect, mock, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
    push: () => undefined,
    refresh: () => undefined,
    replace: () => undefined,
  }),
}));

describe("ProjectDetailDialog", () => {
  test("owns Escape only while it is the unconsumed topmost modal", async () => {
    const { shouldCloseProjectDetailOnEscape } = await import(
      "@/components/project-detail-dialog"
    );
    const projectDialog = { id: "project-detail" } as Element;
    const nestedDialog = { id: "project-edit" } as Element;
    const escape = { key: "Escape", defaultPrevented: false };

    expect(
      shouldCloseProjectDetailOnEscape(escape, projectDialog, [projectDialog]),
    ).toBe(true);
    expect(
      shouldCloseProjectDetailOnEscape(escape, projectDialog, [
        projectDialog,
        nestedDialog,
      ]),
    ).toBe(false);
    expect(
      shouldCloseProjectDetailOnEscape(
        { key: "Escape", defaultPrevented: true },
        projectDialog,
        [projectDialog],
      ),
    ).toBe(false);
  });

  test("renders an accessible, viewport-safe project detail dialog", async () => {
    const { ProjectDetailDialog } = await import(
      "@/components/project-detail-dialog"
    );

    const html = renderToStaticMarkup(
      <ProjectDetailDialog
        title="Công trình Riverside"
        subtitle="Nguyễn An"
        closeLabel="Đóng chi tiết công trình"
      >
        <div>Chi tiết công trình</div>
      </ProjectDetailDialog>,
    );

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain("Công trình Riverside");
    expect(html).toContain("Nguyễn An");
    expect(html).toContain('aria-label="Đóng chi tiết công trình"');
    expect(html).toContain("h-dvh");
    expect(html).toContain("sm:h-[min(92dvh,920px)]");
    expect(html).toContain("max-w-7xl");
    expect(html).toContain("overflow-y-auto");
  });
});
