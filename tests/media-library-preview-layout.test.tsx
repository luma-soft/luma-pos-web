import { afterAll, describe, expect, mock, test } from "bun:test";
import type { ReactNode } from "react";
import * as ReactDOM from "react-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { MediaLibraryItem } from "@/lib/media/library-types";
import vi from "../messages/vi.json";

// SSR has no top layer. Keep the real dialog/preview markup while replacing
// only the portal destination; browser geometry is verified separately.
mock.module("react-dom", () => ({ ...ReactDOM, createPortal: (children: ReactNode) => children }));
const previousDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
Object.defineProperty(globalThis, "document", { configurable: true, value: { body: {} } });
afterAll(() => {
  if (previousDocument) Object.defineProperty(globalThis, "document", previousDocument);
  else Reflect.deleteProperty(globalThis, "document");
  mock.restore();
});

const { LibraryDialog } = await import("@/app/(app)/library/library-dialog");
const { LibraryPreview, LibraryPreviewDetails } = await import("@/app/(app)/library/library-preview");
const item: MediaLibraryItem = {
  id: "preview", mediaId: "media", kind: "image", title: "Ảnh mẫu", album: "Hàng hóa",
  fileName: "sample.jpg", mimeType: "image/jpeg", sizeBytes: 1024, createdAt: "2026-09-03T00:00:00Z",
  creatorName: null, url: "/sample.jpg", thumbnailUrl: null, note: null, tags: [],
};
function render(children: ReactNode) {
  return renderToStaticMarkup(<NextIntlClientProvider locale="vi" messages={vi} timeZone="UTC">{children}</NextIntlClientProvider>);
}

describe("library preview layout", () => {
  test("reserves a viewport-bounded height before the media resolves", () => {
    const html = render(<LibraryPreview item={item} canManage={false} onClose={() => undefined} onDelete={() => undefined} />);
    expect(html).toContain("sm:h-[min(800px,calc(100dvh-4rem))]");
    expect(html).not.toContain("sm:h-fit");
    expect(html).toContain("sm:overflow-hidden");
    expect(html).toContain("sm:grid-rows-[minmax(0,1fr)]");
    expect(html).toContain("h-[45dvh]");
    expect(html).toContain('role="region" aria-label="Ảnh mẫu" tabindex="0"');
    expect(html).toContain("Đang tải thư viện");
  });

  test("gives long metadata its own desktop scroll region", () => {
    const html = render(<LibraryPreviewDetails item={{ ...item, note: "Ghi chú dài\n".repeat(50) }} canManage={false} onExtract={async () => null} />);
    const aside = html.match(/<aside[^>]*>/)?.[0];
    expect(aside).toContain("min-h-0");
    expect(aside).toContain("sm:overflow-y-auto");
    expect(aside).toContain("sm:overscroll-contain");
    expect(html).toContain("Ghi chú dài");
  });

  test("keeps upload and other centered dialogs content-sized", () => {
    const html = render(<LibraryDialog wide title="Tải lên" onClose={() => undefined}><p>Nội dung</p></LibraryDialog>);
    expect(html).toContain("sm:h-fit");
    expect(html).not.toContain("sm:h-[min(800px");
    expect(html).not.toContain("sm:overflow-hidden");
    expect(html).toContain("overflow-y-auto");
  });

  test("keeps the filter drawer full-height and scrollable", () => {
    const html = render(<LibraryDialog placement="drawer" title="Bộ lọc" onClose={() => undefined}><p>Nội dung</p></LibraryDialog>);
    expect(html).toContain("h-dvh");
    expect(html).toContain("max-w-[460px]");
    expect(html).not.toContain("sm:h-fit");
    expect(html).not.toContain("sm:overflow-hidden");
  });
});
