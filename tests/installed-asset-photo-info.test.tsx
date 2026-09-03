import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import {
  AssetPhotoFileInfo,
  loadInstalledAssetPhoto,
  type AssetPhoto,
} from "@/app/(app)/projects/[id]/installed-asset-photo-preview";
import vi from "../messages/vi.json";
import en from "../messages/en.json";

const photo: AssetPhoto = { id: "photo-1", mediaObjectId: "stored-original-1", signedUrl: "https://files.example/fresh-photo.jpg",
  fileName: "original-camera-photo.jpg", mimeType: "image/jpeg", sizeBytes: 3 * 1024 * 1024,
  createdAt: "2026-09-03T05:00:00Z", isPrimary: true, sortOrder: 0 };

describe("installed-asset original photo information", () => {
  test("loads the primary thumbnail from the existing asset endpoint without mutating files", async () => {
    const controller = new AbortController();
    const calls: { url: string; init?: RequestInit }[] = [];
    const result = await loadInstalledAssetPhoto("asset/id", null, controller.signal, (async (input, init) => {
      calls.push({ url: String(input), init });
      return Response.json({ ok: true, data: [{ ...photo, id: "other", isPrimary: false }, photo] });
    }) as typeof fetch);
    expect(result).toEqual(photo);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("/api/mobile/services/assets/asset%2Fid/attachments");
    expect(calls[0].init).toMatchObject({ cache: "no-store", credentials: "same-origin", signal: controller.signal });
    expect(calls[0].init?.body).toBeUndefined();
  });

  test("refreshes the clicked attachment by ID and does not open a different photo after deletion", async () => {
    const fetcher = (async () => Response.json({ ok: true, data: [photo, { ...photo, id: "photo-2", signedUrl: "https://files.example/second.jpg", isPrimary: false }] })) as typeof fetch;
    expect((await loadInstalledAssetPhoto("asset", "photo-2", new AbortController().signal, fetcher))?.signedUrl).toBe("https://files.example/second.jpg");
    expect(await loadInstalledAssetPhoto("asset", "deleted-photo", new AbortController().signal, fetcher)).toBeNull();
    const empty = (async () => Response.json({ ok: true, data: [] })) as typeof fetch;
    expect(await loadInstalledAssetPhoto("asset", null, new AbortController().signal, empty)).toBeNull();
  });

  test("keeps auth, missing resource and malformed response failures distinct from an empty collection", async () => {
    for (const status of [401, 403, 404, 500]) {
      const fetcher = (async () => Response.json({ ok: false }, { status })) as typeof fetch;
      await expect(loadInstalledAssetPhoto("asset", null, new AbortController().signal, fetcher)).rejects.toThrow("ASSET_PHOTO_LOAD_FAILED");
    }
    const malformed = (async () => Response.json({ ok: true, data: {} })) as typeof fetch;
    await expect(loadInstalledAssetPhoto("asset", null, new AbortController().signal, malformed)).rejects.toThrow("ASSET_PHOTO_LOAD_FAILED");
  });

  for (const locale of ["vi", "en"] as const) {
    const messages = locale === "vi" ? vi : en;
    test(`${locale}: uses the shared file-info disclosure and labels unmanaged originals without an extraction action`, () => {
      const errors: string[] = [];
      const render = (value: AssetPhoto) => renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={messages} timeZone="UTC" onError={(error) => errors.push(error.message)}><AssetPhotoFileInfo photo={value} /></NextIntlClientProvider>);
      const managed = render(photo);
      expect(managed).toContain(messages.fileInfo.title);
      expect(managed).toContain(photo.fileName);
      expect(managed).toContain(messages.fileInfo.uploadedAt);
      expect(managed).not.toContain("<button");
      expect(managed).not.toContain(messages.fileInfo.legacyFileHint);
      const legacy = render({ ...photo, mediaObjectId: null });
      expect(legacy).toContain(messages.fileInfo.legacyFileHint);
      expect(legacy).not.toContain("<button");
      expect(legacy).not.toContain("<select");
      expect(errors).toEqual([]);
    });
  }
});
