import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { ConfirmDialogProvider } from "@/components/confirm-dialog-provider";
import { LibraryTile, MediaLibraryClient } from "@/app/(app)/library/media-library-client";
import { LibraryAlbumOptions } from "@/app/(app)/library/library-filter-drawer";
import { LibraryPreviewDetails } from "@/app/(app)/library/library-preview";
import { libraryAlbumKey, libraryAlbumSelection, libraryCanDelete, libraryCanExtractMetadata, libraryItemSizeKnown, libraryItemUploadedAt, libraryListPath, libraryManualAlbums } from "@/app/(app)/library/library-utils";
import type { MediaLibraryAlbum, MediaLibraryItem } from "@/lib/media/library-types";
import vi from "../messages/vi.json";
import en from "../messages/en.json";

const sourceItem: MediaLibraryItem = { id: "pu:product:opaque", mediaId: "", kind: "image", title: "Đèn thả mẫu", album: "Hàng hóa",
  fileName: "pendant.jpg", mimeType: "image/jpeg", sizeBytes: 0, sizeKnown: false, uploadedAt: null,
  createdAt: "2026-09-03T05:00:00Z", creatorName: null, url: "https://files.example/pendant.jpg", thumbnailUrl: null,
  note: null, tags: [], source: { type: "product", id: "product", label: "Đèn thả mẫu" } };
const albums: MediaLibraryAlbum[] = [
  { name: "Hàng hóa", count: 1, system: true, source: "products", key: "auto:products" },
  { name: "Thi công camera", count: 0, system: true, source: "camera", key: "auto:camera" },
  { name: "Hàng hóa", count: 1 },
];
const manualItem: MediaLibraryItem = { ...sourceItem, id: "manual", mediaId: "media", source: undefined, sizeKnown: undefined, uploadedAt: undefined };

function render(content: ReactNode, locale: "vi" | "en" = "vi") {
  const errors: string[] = [];
  const html = renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={locale === "vi" ? vi : en} timeZone="UTC" onError={(error) => errors.push(error.message)}>{content}</NextIntlClientProvider>);
  expect(errors).toEqual([]);
  return html;
}

describe("linked library UI", () => {
  test("opts into source albums on every list request and never combines source with a manual album", () => {
    const all = new URL(libraryListPath("", "", ""), "https://luma.test");
    expect(all.searchParams.get("includeSources")).toBe("1");
    const path = libraryListPath("  camera & đèn  ", "Manual album", "image", "opaque+/cursor", "camera");
    const filtered = new URL(path, "https://luma.test");
    expect(filtered.searchParams.get("source")).toBe("camera");
    expect(filtered.searchParams.has("album")).toBe(false);
    expect(filtered.searchParams.get("cursor")).toBe("opaque+/cursor");
    expect(filtered.searchParams.get("q")).toBe("camera & đèn");
  });

  test("keeps same-name manual and automatic albums distinct and excludes automatic upload targets", () => {
    expect(libraryAlbumKey(albums[0])).not.toBe(libraryAlbumKey(albums[2]));
    expect(libraryAlbumSelection(albums[0])).toEqual({ album: "", source: "products" });
    expect(libraryAlbumSelection(albums[2])).toEqual({ album: "Hàng hóa", source: "" });
    expect(libraryManualAlbums(albums)).toEqual([albums[2]]);
    expect(libraryManualAlbums([{ name: "Reserved", count: 0, system: true }])).toEqual([]);
  });

  test("source items never inherit manager delete or extraction permissions", () => {
    expect(libraryCanDelete(sourceItem, true)).toBe(false);
    expect(libraryCanDelete({ ...sourceItem, canDelete: true }, true)).toBe(false);
    expect(libraryCanDelete(manualItem, true)).toBe(true);
    expect(libraryCanDelete({ ...manualItem, canDelete: false }, true)).toBe(false);
    expect(libraryCanExtractMetadata(sourceItem, true)).toBe(false);
    expect(libraryCanExtractMetadata({ ...sourceItem, canExtractMetadata: true }, false)).toBe(true);
    expect(libraryCanExtractMetadata(manualItem, true)).toBe(true);
    expect(libraryCanExtractMetadata({ ...manualItem, canExtractMetadata: false }, true)).toBe(false);
  });

  test("legacy source facts are unknown while manual items retain compatible known values", () => {
    expect(libraryItemSizeKnown(sourceItem)).toBe(false);
    expect(libraryItemSizeKnown({ ...sourceItem, sizeKnown: undefined })).toBe(false);
    expect(libraryItemSizeKnown({ ...sourceItem, sizeKnown: undefined, sizeBytes: 100 })).toBe(true);
    expect(libraryItemUploadedAt(sourceItem)).toBeNull();
    expect(libraryItemUploadedAt({ ...sourceItem, uploadedAt: undefined })).toBeNull();
    expect(libraryItemUploadedAt({ ...sourceItem, uploadedAt: "2026-09-02T03:00:00Z" })).toBe("2026-09-02T03:00:00Z");
    expect(libraryItemSizeKnown(manualItem)).toBe(true);
    expect(libraryItemUploadedAt(manualItem)).toBe(manualItem.createdAt);
  });

  test("source details stay hidden while current source access is unresolved or denied", () => {
    const html = render(<LibraryPreviewDetails item={{ ...sourceItem, canExtractMetadata: true,
      metadata: { version: 1, status: "ready", extractedAt: "2026-09-03T00:00:00Z", latitude: 10.123456, longitude: 106.654321 } }}
      canManage extractionReady={false} onExtract={async () => null} />);
    expect(html).toBe("");
  });

  for (const locale of ["vi", "en"] as const) {
    test(`${locale}: marks linked tiles as automatic without inventing a 0 B file size`, () => {
      for (const type of ["product", "project", "job", "asset"] as const) {
        const html = render(<LibraryTile item={{ ...sourceItem, source: { ...sourceItem.source!, type } }} locale={locale} onOpen={() => undefined} />, locale);
        expect(html).toContain(locale === "vi" ? "Tự động" : "Automatic");
        expect(html).toContain(locale === "vi" ? "Chưa rõ dung lượng" : "Size unknown");
        expect(html).toContain(locale === "vi" ? "Ảnh liên kết từ Đèn thả mẫu" : "Linked from Đèn thả mẫu");
        expect(html).not.toContain("0 B");
      }
    });

    test(`${locale}: opened filter content preserves zero-count authorized presets and distinct matching labels`, () => {
      const html = render(<LibraryAlbumOptions albums={albums} totalCount={2} selection={{ album: "", source: "products" }} onChange={() => undefined} />, locale);
      const buttons = html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g)!;
      expect(buttons).toHaveLength(4);
      expect(buttons.filter((button) => button.includes('aria-pressed="true"'))).toHaveLength(1);
      expect(buttons[1]).toContain('aria-pressed="true"');
      expect(buttons[2]).toContain(locale === "vi" ? "Thi công camera" : "Camera installation");
      expect(buttons[2]).toContain(">0</span>");
      expect(buttons[3]).toContain("Hàng hóa");
      expect(buttons[3]).toContain('aria-pressed="false"');
      expect(html).toContain(locale === "vi" ? "Album tải lên" : "Uploaded album");
      expect(html).not.toMatch(/<(?:select|datalist)\b/);
      const restricted = render(<LibraryAlbumOptions albums={[albums[1]]} totalCount={0} selection={{ album: "", source: "" }} onChange={() => undefined} />, locale);
      expect(restricted).not.toContain(locale === "vi" ? "Hàng hóa" : "Products");
    });

    test(`${locale}: source preview keeps missing facts unknown and only shows explicitly authorized metadata extraction`, () => {
      const html = render(<LibraryPreviewDetails item={sourceItem} canManage onExtract={async () => null} />, locale);
      expect(html).not.toContain("0 B");
      expect(html).not.toContain("2026");
      expect(html).toContain(locale === "vi" ? vi.fileInfo.unknown : en.fileInfo.unknown);
      expect(html).not.toContain(locale === "vi" ? vi.fileInfo.extract : en.fileInfo.extract);
      expect(html).toContain(locale === "vi" ? vi.mediaLibrary.sourceReadOnlyHint : en.mediaLibrary.sourceReadOnlyHint);
      const permitted = render(<LibraryPreviewDetails item={{ ...sourceItem, canExtractMetadata: true }} canManage={false} onExtract={async () => null} />, locale);
      expect(permitted).toContain(locale === "vi" ? vi.fileInfo.extract : en.fileInfo.extract);
      const wildcard = render(<LibraryPreviewDetails item={{ ...sourceItem, mimeType: "image/*" }} canManage onExtract={async () => null} />, locale);
      expect(wildcard).not.toContain("image/*");
      expect(wildcard).not.toContain("image/jpeg");
      expect(wildcard).toContain(locale === "vi" ? vi.fileInfo.unknown : en.fileInfo.unknown);
    });

    test(`${locale}: library total includes linked files while storage describes uploaded files only`, () => {
      const html = render(<ConfirmDialogProvider><MediaLibraryClient storeId="store" initialSnapshot={{ items: [sourceItem, manualItem], albums,
        usage: { libraryBytes: 1024, libraryObjects: 1, totalBytes: 2048, totalObjects: 10 }, canManage: false,
        page: { hasMore: false, nextCursor: null, totalItems: 6 } }} /></ConfirmDialogProvider>, locale);
      expect(html).toContain(locale === "vi" ? "1 tệp tải riêng · 1 KB" : "1 uploaded files · 1 KB");
      expect(html).toContain(locale === "vi" ? "6 tệp" : "6 files");
      expect(html).toContain(locale === "vi" ? vi.mediaLibrary.linkedStorageHint : en.mediaLibrary.linkedStorageHint);
    });
  }
});
