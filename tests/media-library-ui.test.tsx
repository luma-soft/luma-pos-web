import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { ConfirmDialogProvider } from "@/components/confirm-dialog-provider";
import { MediaLibraryClient } from "@/app/(app)/library/media-library-client";
import {
  formatLibraryBytes,
  libraryFileKey,
  libraryFileTitle,
  libraryListPath,
  libraryMetadataValid,
} from "@/app/(app)/library/library-utils";
import type { MediaLibraryItem, MediaLibrarySnapshot } from "@/lib/media/library-types";
import en from "../messages/en.json";
import vi from "../messages/vi.json";

const storeId = "11111111-1111-4111-8111-111111111111";
const fixtures: MediaLibraryItem[] = [
  { id: "image-1", mediaId: "media-image-1", kind: "image", title: "Vòi EL-005", album: "Thiết bị vệ sinh", fileName: "EL-005.jpg", mimeType: "image/jpeg", sizeBytes: 1_572_864, url: "https://files.luma.test/EL-005.jpg", thumbnailUrl: null, createdAt: "2026-09-01T00:00:00.000000Z", creatorName: null, tags: [], note: null },
  { id: "video-1", mediaId: "media-video-1", kind: "video", title: "Video đèn thả", album: "Đèn trang trí", fileName: "pendant.mp4", mimeType: "video/mp4", sizeBytes: 10_485_760, url: "https://files.luma.test/pendant.mp4", thumbnailUrl: null, createdAt: "2026-09-01T00:00:00.000000Z", creatorName: null, tags: [], note: null },
  { id: "document-1", mediaId: "media-document-1", kind: "document", title: "Báo giá tháng 9", album: "Báo giá", fileName: "quote.pdf", mimeType: "application/pdf", sizeBytes: 24_576, url: "https://files.luma.test/quote.pdf", thumbnailUrl: null, createdAt: "2026-09-01T00:00:00.000000Z", creatorName: null, tags: [], note: null },
];

function snapshot(overrides: Partial<MediaLibrarySnapshot> = {}): MediaLibrarySnapshot {
  return {
    items: fixtures,
    albums: fixtures.map((item) => ({ name: item.album, count: 1 })),
    usage: { libraryBytes: 1_572_864, libraryObjects: 1350, totalBytes: 2_684_354_560, totalObjects: 1500 },
    canManage: true,
    page: { hasMore: true, nextCursor: "opaque-cursor", totalItems: 1350 },
    ...overrides,
  };
}

function renderLibrary(locale: "vi" | "en", value = snapshot()) {
  const errors: string[] = [];
  const html = renderToStaticMarkup(
    <NextIntlClientProvider locale={locale} messages={locale === "vi" ? vi : en} timeZone="UTC"
      onError={(error) => errors.push(error.message)}>
      <ConfirmDialogProvider>
        <MediaLibraryClient initialSnapshot={value} storeId={storeId} />
      </ConfirmDialogProvider>
    </NextIntlClientProvider>,
  );
  expect(errors).toEqual([]);
  return html;
}

describe("library UI utilities", () => {
  test("formats storage using the active locale and bounded binary units", () => {
    expect(formatLibraryBytes(0, "vi")).toBe("0 B");
    expect(formatLibraryBytes(1023, "en")).toBe("1,023 B");
    expect(formatLibraryBytes(24_576, "vi")).toBe("24 KB");
    expect(formatLibraryBytes(1_572_864, "vi")).toBe("1,5 MB");
    expect(formatLibraryBytes(1_572_864, "en")).toBe("1.5 MB");
    expect(formatLibraryBytes(2_684_354_560, "vi")).toBe("2,5 GB");
    expect(formatLibraryBytes(2_684_354_560, "en")).toBe("2.5 GB");
    expect(formatLibraryBytes(1024 ** 4, "en")).toBe("1 TB");
  });

  test("validates optional metadata before upload at the server's exact boundaries", () => {
    expect(libraryMetadataValid("", "", [])).toBe(true);
    expect(libraryMetadataValid(" ", " ", [""])).toBe(true);
    expect(libraryMetadataValid("a".repeat(80), "n".repeat(500), Array.from({ length: 12 }, (_, index) => `${index}`))).toBe(true);
    expect(libraryMetadataValid("a".repeat(81), "", [])).toBe(false);
    expect(libraryMetadataValid("", "n".repeat(501), [])).toBe(false);
    expect(libraryMetadataValid("", "", Array.from({ length: 13 }, (_, index) => `${index}`))).toBe(false);
    expect(libraryMetadataValid("", "", ["t".repeat(40)])).toBe(true);
    expect(libraryMetadataValid("", "", ["t".repeat(41)])).toBe(false);
  });

  test("derives a nonempty title without the final extension and never exceeds 160 characters", () => {
    expect(libraryFileTitle("  Vòi chậu EL-005.jpg")).toBe("Vòi chậu EL-005");
    expect(libraryFileTitle("Báo giá.v2.xlsx")).toBe("Báo giá.v2");
    expect(libraryFileTitle("a".repeat(161) + ".mp4")).toBe("a".repeat(160));
    expect(libraryFileTitle("  ")).toBe("File");
    expect(libraryFileTitle(".pdf").length).toBeGreaterThan(0);
  });

  test("distinguishes same-name selections by size and modification time", () => {
    expect(libraryFileKey({ name: "mẫu.jpg", size: 123, lastModified: 456 })).toBe("mẫu.jpg:123:456");
    expect(libraryFileKey({ name: "mẫu.jpg", size: 123, lastModified: 456 })).not.toBe(libraryFileKey({ name: "mẫu.jpg", size: 124, lastModified: 456 }));
    expect(libraryFileKey({ name: "mẫu.jpg", size: 123, lastModified: 456 })).not.toBe(libraryFileKey({ name: "mẫu.jpg", size: 123, lastModified: 457 }));
  });

  test("encodes filters and opaque cursors without changing their content", () => {
    const path = libraryListPath("  vòi & chậu?  ", "Báo giá/2026 + tháng 9", "document", "cursor+/=_-");
    const url = new URL(path, "https://luma.test");
    expect(url.pathname).toBe("/api/mobile/library");
    expect(url.searchParams.get("q")).toBe("vòi & chậu?");
    expect(url.searchParams.get("album")).toBe("Báo giá/2026 + tháng 9");
    expect(url.searchParams.get("kind")).toBe("document");
    expect(url.searchParams.get("cursor")).toBe("cursor+/=_-");
    expect(libraryListPath(" ", "", "", null)).toBe("/api/mobile/library");
    for (const kind of ["image", "video", "document"]) {
      expect(new URL(libraryListPath("", "", kind), "https://luma.test").searchParams.get("kind")).toBe(kind);
    }
  });
});

describe("library bilingual server composition", () => {
  for (const locale of ["vi", "en"] as const) {
    const copy = locale === "vi" ? vi.mediaLibrary : en.mediaLibrary;
    test(`${locale}: renders image, video and document tiles with the real total and pagination`, () => {
      const html = renderLibrary(locale);
      expect(html).toContain(copy.title);
      expect(html.match(/<article\b/g)?.length).toBe(3);
      for (const item of fixtures) expect(html).toContain(item.title);
      for (const kind of ["image", "video", "document"] as const) expect(html).toContain(copy.types[kind]);
      expect(html).toContain(locale === "vi" ? "1,5 MB" : "1.5 MB");
      expect(html).toContain(locale === "vi" ? "1350 tệp" : "1350 files");
      expect(html).toContain(copy.loadMore);
      expect(html).toContain("object-contain");
      expect(html).not.toContain("<video");
    });

    test(`${locale}: keeps storage in a closed disclosure and uses custom controls`, () => {
      const html = renderLibrary(locale);
      const detailsTag = html.match(/<details\b[^>]*>/)?.[0];
      expect(detailsTag).toBeDefined();
      expect(detailsTag).not.toMatch(/\sopen(?:=|\s|>)/);
      expect(html).toContain("<summary");
      expect(html).toContain(copy.storageDetails);
      expect(html).toContain(copy.usageTotal);
      expect(html).toContain(copy.privateShort);
      expect(html).toContain(copy.filterButton);
      expect(html).toContain('aria-haspopup="dialog"');
      expect(html).toContain('aria-expanded="false"');
      expect(html).not.toMatch(/<aside\b/);
      expect(html).not.toMatch(/<(?:select|datalist)\b/);
    });

    test(`${locale}: read-only staff cannot see upload actions, including the empty state`, () => {
      for (const items of [fixtures, []]) {
        const html = renderLibrary(locale, snapshot({ canManage: false, items, page: { hasMore: false, nextCursor: null, totalItems: items.length } }));
        expect(html).not.toContain(copy.upload);
        expect(html).not.toContain(copy.addShort);
        expect(html).not.toContain(copy.loadMore);
        if (items.length === 0) expect(html).toContain(copy.emptyTitle);
      }
      expect(renderLibrary(locale)).toContain(copy.upload);
    });
  }
});
