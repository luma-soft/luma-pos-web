import { describe, expect, test } from "bun:test";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { NextIntlClientProvider } from "next-intl";
import { FileInfoPanel, FileMetadataRows } from "@/components/media/file-info-panel";
import { canExtractFileMetadata, formatFileInfoBytes, formatSourceTimestamp, hasFileCoordinates } from "@/components/media/file-info-utils";
import { extractProjectFileMetadata, loadProjectFileInfo, ProjectFileInfo } from "@/app/(app)/projects/[id]/project-file-info";
import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";
import vi from "../messages/vi.json";
import en from "../messages/en.json";

const ready: MediaFileMetadata = {
  version: 1, status: "ready", extractedAt: "2026-09-03T05:00:00Z",
  capturedAt: "2026-09-02T14:35:06", fileCreatedAt: "2026-09-01T23:55:00+07:00", fileModifiedAt: "2026-09-02T01:00:00Z",
  latitude: 0, longitude: 0, altitude: 0, make: "Apple", model: "iPhone 17 Pro", lens: "Camera wide",
  width: 4032, height: 3024, durationSeconds: 90.5, frameRate: 29.97,
  videoCodec: "HEVC", audioCodec: "AAC", software: "Camera", format: "HEIF",
  iso: 100, fNumber: 1.8, exposureTime: 0.008, focalLength: 24, orientation: 1,
};
const file = { fileName: `${"very-long-original-file-name-".repeat(8)}.heic`, mimeType: "image/heic", sizeBytes: 1_572_864, uploadedAt: "2026-09-03T05:00:00Z", uploaderName: "Nguyễn An" };

function render(node: ReactNode, locale: "vi" | "en" = "vi") {
  const errors: string[] = [];
  const html = renderToStaticMarkup(<NextIntlClientProvider locale={locale} messages={locale === "vi" ? vi : en} timeZone="UTC" onError={(error) => errors.push(error.message)}>{node}</NextIntlClientProvider>);
  expect(errors).toEqual([]);
  return html;
}

describe("original metadata formatting", () => {
  test("keeps timezone-less camera timestamps as source wall time and flags the unknown zone", () => {
    const result = formatSourceTimestamp(ready.capturedAt, "vi")!;
    expect(result.timezone).toBeNull();
    expect(result.text).toContain("14:35:06");
    expect(result.text).not.toContain("21:35");
    expect(render(<FileMetadataRows metadata={ready} />)).toContain(vi.fileInfo.timezoneUnknown);
  });

  test("preserves explicit offsets, Z, source calendar dates and date-only values", () => {
    expect(formatSourceTimestamp(ready.fileCreatedAt, "vi")).toMatchObject({ timezone: "UTC+07:00" });
    expect(formatSourceTimestamp(ready.fileCreatedAt, "vi")?.text).toContain("23:55:00");
    expect(formatSourceTimestamp(ready.fileModifiedAt, "en")?.timezone).toBe("UTC");
    expect(formatSourceTimestamp("2024-02-29", "vi")?.timezone).toBeNull();
    expect(formatSourceTimestamp("2024-02-29", "vi")?.text).not.toContain("00:00");
  });

  test("does not normalize invalid dates or invent values for missing timestamps", () => {
    for (const value of [undefined, "", "not-a-date", "2026-02-29T12:00:00", "2026-13-01T12:00:00", "2026-01-01T25:00:00", "2026-01-01T12:00:00+99:00"]) {
      expect(formatSourceTimestamp(value, "vi")).toBeNull();
    }
  });

  test("zero coordinates are valid, but missing, non-finite and out-of-range pairs are not", () => {
    expect(hasFileCoordinates(ready)).toBe(true);
    for (const value of [null, { ...ready, latitude: undefined }, { ...ready, longitude: undefined }, { ...ready, latitude: NaN }, { ...ready, longitude: Infinity }, { ...ready, latitude: 91 }, { ...ready, longitude: -181 }]) expect(hasFileCoordinates(value)).toBe(false);
    expect(render(<FileMetadataRows metadata={ready} />)).toContain("0, 0");
    const missingCoordinates = render(<FileMetadataRows metadata={{ ...ready, latitude: undefined }} />);
    expect(missingCoordinates).toContain(vi.fileInfo.coordinates);
    expect(missingCoordinates).toContain(vi.fileInfo.notInFile);
    expect(missingCoordinates).not.toContain("0, 0");
  });

  test("formats finite binary size using the active locale", () => {
    expect(formatFileInfoBytes(file.sizeBytes, "vi")).toBe("1,5 MB");
    expect(formatFileInfoBytes(file.sizeBytes, "en")).toBe("1.5 MB");
    for (const value of [-1, NaN, Infinity]) expect(formatFileInfoBytes(value, "vi")).toBe("0 B");
  });
});

describe("shared bilingual file information disclosure", () => {
  for (const locale of ["vi", "en"] as const) {
    const copy = (locale === "vi" ? vi : en).fileInfo;
    test(`${locale}: separates stored-file facts from every supplied original metadata field`, () => {
      const html = render(<FileInfoPanel {...file} metadata={ready} />, locale);
      for (const key of ["title", "storedFile", "originalMetadata", "fileName", "mimeType", "size", "uploadedAt", "uploader", "capturedAt", "fileCreatedAt", "fileModifiedAt", "timezoneUnknown", "coordinates", "altitude", "make", "model", "lens", "software", "format", "dimensions", "durationSeconds", "frameRate", "videoCodec", "audioCodec", "orientation", "iso", "fNumber", "exposureTime", "focalLength"] as const) expect(html).toContain(copy[key]);
      expect(html).toContain(file.fileName);
      expect(html).toContain(file.uploaderName);
      expect(html).toContain("0, 0");
      expect(html).toContain("break-all");
      expect(html).toContain("focus-visible:outline-primary-600");
      expect(html).toContain('<summary tabindex="0"');
      expect(html.match(/<details[^>]*>/)?.[0]).not.toMatch(/\sopen(?:=|\s|>)/);
      expect(html).not.toMatch(/<a\b|<iframe\b|<select\b|<datalist\b/);
      expect(html).toContain(copy.sourceHint);
    });

    test(`${locale}: distinguishes not-read, no-data, unsupported and failed states`, () => {
      for (const status of ["missing", "empty", "unsupported", "failed"] as const) {
        const html = render(<FileMetadataRows metadata={status === "missing" ? null : { version: 1, status, extractedAt: ready.extractedAt }} />, locale);
        expect(html).toContain(copy.statuses[status]);
        expect(html).not.toContain(copy.coordinates);
        expect(html).not.toContain(copy.capturedAt);
      }
      const readyWithoutCaptureData = render(<FileMetadataRows metadata={{ version: 1, status: "ready", extractedAt: ready.extractedAt, width: 800, height: 600 }} />, locale);
      expect(readyWithoutCaptureData).toContain(copy.capturedAt);
      expect(readyWithoutCaptureData).toContain(copy.coordinates);
      expect(readyWithoutCaptureData.split(copy.notInFile)).toHaveLength(3);
    });

    test(`${locale}: allows extraction only for managers with missing or failed information`, () => {
      for (const metadata of [undefined, null, { ...ready, status: "failed" as const }, { ...ready, status: "empty" as const }, { ...ready, status: "unsupported" as const }, ready]) {
        const expectedAction = metadata?.status === "failed" ? copy.retryExtract : copy.extract;
        const html = render(<FileInfoPanel {...file} metadata={metadata} canManage onExtract={async () => ready} />, locale);
        if (canExtractFileMetadata(metadata)) expect(html).toContain(expectedAction);
        else expect(html).not.toContain("<button");
        expect(render(<FileInfoPanel {...file} metadata={metadata} canManage={false} onExtract={async () => ready} />, locale)).not.toContain("<button");
      }
    });
  }

  test("works for image, video and document originals, with explicit unknown uploader", () => {
    for (const mimeType of ["image/jpeg", "video/mp4", "application/pdf"]) {
      const html = render(<FileInfoPanel {...file} mimeType={mimeType} uploaderName={null} metadata={null} />);
      expect(html).toContain(mimeType);
      expect(html).toContain(vi.fileInfo.unknown);
      expect(html).toContain(vi.fileInfo.statuses.missing);
    }
  });

  test("a server target capability takes precedence over the role fallback", () => {
    expect(render(<FileInfoPanel {...file} metadata={null} canManage={false} canExtractMetadata onExtract={async () => ready} />)).toContain(vi.fileInfo.extract);
    expect(render(<FileInfoPanel {...file} metadata={null} canManage canExtractMetadata={false} onExtract={async () => ready} />)).not.toContain("<button");
  });

  test("project information stays lazy and hides extraction until the descriptor has loaded", () => {
    let loaded = false;
    render(<FileInfoPanel {...file} metadata={null} canManage onLoad={async () => { loaded = true; return { metadata: null }; }} onExtract={async () => ready} />);
    expect(loaded).toBe(false);
    const html = render(<ProjectFileInfo item={{ id: "attachment", mediaId: "stored-original", fileName: file.fileName, mimeType: file.mimeType, sizeBytes: file.sizeBytes, createdAt: file.uploadedAt, phase: "construction", caption: null }} canManage />);
    expect(html).toContain(vi.fileInfo.title);
    expect(html).not.toContain("<button");
  });
});

describe("construction file information API adapter", () => {
  test("loads the authorized shared descriptor by mediaId without requesting extraction", async () => {
    const controller = new AbortController();
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetcher = (async (input, init) => {
      calls.push({ input: String(input), init });
      return Response.json({ ok: true, data: { metadata: ready, creatorName: "Nguyễn An", canExtractMetadata: true } });
    }) as typeof fetch;
    expect(await loadProjectFileInfo("original/id", controller.signal, fetcher)).toEqual({ metadata: ready, uploaderName: "Nguyễn An", canExtractMetadata: true });
    expect(calls).toHaveLength(1);
    expect(calls[0].input).toBe("/api/mobile/media/original%2Fid");
    expect(calls[0].init).toMatchObject({ method: "GET", credentials: "same-origin", cache: "no-store", signal: controller.signal });
  });

  test("extracts the original by authenticated POST and returns updated metadata", async () => {
    const calls: { input: string; init?: RequestInit }[] = [];
    const fetcher = (async (input, init) => { calls.push({ input: String(input), init }); return Response.json({ ok: true, data: { metadata: ready } }); }) as typeof fetch;
    expect(await extractProjectFileMetadata("original-id", new AbortController().signal, fetcher)).toEqual(ready);
    expect(calls[0].input).toBe("/api/mobile/media/original-id/metadata");
    expect(calls[0].init?.method).toBe("POST");
    expect(calls[0].init?.body).toBeUndefined();
  });

  test("does not turn auth/transport failures into a misleading no-metadata result", async () => {
    for (const status of [401, 403, 404, 500]) {
      const fetcher = (async () => Response.json({ ok: false, error: "denied" }, { status })) as typeof fetch;
      await expect(loadProjectFileInfo("id", new AbortController().signal, fetcher)).rejects.toThrow("FILE_METADATA_REQUEST_FAILED");
      await expect(extractProjectFileMetadata("id", new AbortController().signal, fetcher)).rejects.toThrow("FILE_METADATA_REQUEST_FAILED");
    }
    const fetcher = (async () => Response.json({ ok: true, data: {} })) as typeof fetch;
    expect(await loadProjectFileInfo("old-file", new AbortController().signal, fetcher)).toEqual({ metadata: null, uploaderName: undefined, canExtractMetadata: undefined });
  });
});
