import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import vi from "../messages/vi.json";
import { FIT_IMAGE, ProjectImageViewport, constrainProjectImage, zoomProjectImage } from "../src/app/(app)/projects/[id]/project-image-viewport";

describe("project image zoom", () => {
  test("zooms around the touched point without shifting that image point", () => {
    const next = zoomProjectImage(FIT_IMAGE, 2.5, { x: 40, y: -20 });
    expect(next).toEqual({ scale: 2.5, x: -60, y: 30 });
    expect((40 - next.x) / next.scale).toBe(40);
    expect((-20 - next.y) / next.scale).toBe(-20);
  });
  test("clamps zoom to 100–600% and resets pan on fit", () => {
    expect(zoomProjectImage(FIT_IMAGE, 20, { x: 0, y: 0 }).scale).toBe(6);
    expect(zoomProjectImage({ scale: 3, x: 80, y: 30 }, 0.5, { x: 100, y: 80 })).toEqual(FIT_IMAGE);
  });
  test("keeps panning bounded and zooming back out reversible", () => {
    expect(constrainProjectImage({ scale: 2, x: 999, y: -999 }, 400, 600)).toEqual({ scale: 2, x: 200, y: -300 });
    const zoomed = zoomProjectImage(FIT_IMAGE, 2, { x: 30, y: -20 });
    expect(zoomProjectImage(zoomed, 1, { x: 30, y: -20 })).toEqual(FIT_IMAGE);
  });
  test("offers discoverable zoom controls and a touch gesture viewport", () => {
    const html = renderToStaticMarkup(<NextIntlClientProvider locale="vi" messages={vi} timeZone="Asia/Ho_Chi_Minh">
      <ProjectImageViewport url="https://signed.example/photo.jpg" fileName="photo.jpg" onRetry={() => undefined} />
    </NextIntlClientProvider>);
    expect(html).toContain('data-testid="project-image-viewport"');
    expect(html).toContain("touch-none");
    expect(html).toContain('aria-label="Phóng to"');
    expect(html).toContain('aria-label="Thu nhỏ"');
    expect(html).toContain("Vừa màn hình");
    expect(html).toContain("100%");
  });
});
