import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  PROJECT_MEDIA_UPLOAD_CONCURRENCY,
  snapshotProjectMediaUploadTargets,
  uploadProjectMediaFiles,
} from "@/app/(app)/projects/[id]/project-media-panel";
import { extractFileMetadata } from "@/lib/media/file-metadata";
import { uploadIntentSchema } from "@/lib/media/schemas";

const projectId = "a1000000-0000-4000-8000-000000000003";
const maxBytes = 25 * 1024 * 1024;
const digest = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

async function originalPhoto() {
  return sharp({ create: { width: 32, height: 24, channels: 3, background: "white" } })
    .jpeg().withExif({
      IFD0: { Make: "Luma camera", Model: "Construction original", Orientation: "6" },
      IFD2: { DateTimeOriginal: "2026:08:01 10:04:05", OffsetTimeOriginal: "+07:00" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "0/1 0/1 0/1", GPSLongitudeRef: "E", GPSLongitude: "0/1 0/1 0/1" },
    }).toBuffer();
}

function uploadedDescriptor(file: File) {
  return { id: "attachment", mediaId: "original", phase: "construction", caption: null,
    fileName: file.name, mimeType: file.type, sizeBytes: file.size, createdAt: "2026-09-03T05:00:00Z" };
}

describe("construction web uploads preserve original metadata", () => {
  test("keeps real JPEG EXIF, bytes, filename and MIME intact through the upload FormData", async () => {
    const bytes = await originalPhoto();
    const original = new File([new Uint8Array(bytes)], "thi-cong-original.jpg", { type: "image/jpeg", lastModified: 1788411600000 });
    const files = snapshotProjectMediaUploadTargets([{ localId: "original-id", file: original }], { phase: "construction", caption: "Nguyên bản" });
    expect(files[0].file).toBe(original);
    let submitted = 0;
    const result = await uploadProjectMediaFiles({ projectId, files, phase: "construction",
      fetcher: async (_input, init) => {
        submitted++;
        const form = init?.body as FormData;
        const file = form.get("file") as File;
        const uploaded = new Uint8Array(await file.arrayBuffer());
        expect(file.name).toBe(original.name);
        expect(file.type).toBe(original.type);
        expect(file.size).toBe(original.size);
        expect(digest(uploaded)).toBe(digest(bytes));
        expect(form.get("caption")).toBe("Nguyên bản");
        expect(form.get("idempotencyKey")).toBe("original-id");
        const metadata = await extractFileMetadata({ mimeType: file.type, sizeBytes: file.size,
          read: async (size, offset) => uploaded.subarray(offset, offset + size) });
        expect(metadata).toMatchObject({ status: "ready", make: "Luma camera", model: "Construction original",
          capturedAt: "2026-08-01T10:04:05+07:00", latitude: 0, longitude: 0, width: 32, height: 24 });
        return Response.json({ ok: true, data: uploadedDescriptor(file) });
      },
    });
    expect(submitted).toBe(1);
    expect(result[0].status).toBe("complete");
  });

  test("preserves an original at the full 25 MiB boundary and rejects larger managed originals", async () => {
    const jpeg = await originalPhoto();
    // JPEG permits trailing padding; the original deliberately fills the upload limit.
    const originalBytes = Buffer.alloc(maxBytes);
    jpeg.copy(originalBytes);
    const original = new File([originalBytes], "full-size-original.jpg", { type: "image/jpeg" });
    const input = { purpose: "project-document", targetId: projectId, fileName: original.name, mimeType: original.type, sizeBytes: maxBytes };
    expect(uploadIntentSchema.safeParse(input).success).toBe(true);
    const oversized = uploadIntentSchema.safeParse({ ...input, sizeBytes: maxBytes + 1 });
    expect(oversized.success).toBe(false);
    if (!oversized.success) expect(oversized.error.issues.some((issue) => issue.path[0] === "sizeBytes")).toBe(true);
    const result = await uploadProjectMediaFiles({ projectId, files: [{ localId: "full-size", file: original }], phase: "construction",
      fetcher: async (_input, init) => {
        const file = (init?.body as FormData).get("file") as File;
        expect(file.size).toBe(maxBytes);
        expect(digest(new Uint8Array(await file.arrayBuffer()))).toBe(digest(originalBytes));
        return Response.json({ ok: true, data: uploadedDescriptor(file) });
      },
    });
    expect(result[0].status).toBe("complete");
  });

  test("does not pre-read originals and bounds simultaneously submitted full-size payloads to three", async () => {
    const original = new File([new Uint8Array(maxBytes)], "large-original.heic", { type: "image/heic" });
    let reads = 0;
    Object.defineProperty(original, "arrayBuffer", { value: () => { reads++; throw new Error("Unexpected client-side image decode"); } });
    const files = Array.from({ length: 7 }, (_, index) => ({ localId: `large-${index}`, file: original }));
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    let completed = 0;
    const pending = uploadProjectMediaFiles({ projectId, files, phase: "construction",
      fetcher: async (_input, init) => {
        const file = (init?.body as FormData).get("file") as File;
        active++;
        peak = Math.max(peak, active);
        expect(file.size).toBe(maxBytes);
        await new Promise<void>((resolve) => releases.push(resolve));
        active--;
        completed++;
        return Response.json({ ok: true, data: uploadedDescriptor(file) });
      },
    });
    expect(active).toBe(PROJECT_MEDIA_UPLOAD_CONCURRENCY);
    while (completed < files.length) {
      releases.splice(0).forEach((release) => release());
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
    expect((await pending).every((result) => result.status === "complete")).toBe(true);
    expect(peak).toBe(3);
    expect(peak * maxBytes).toBe(75 * 1024 * 1024);
    expect(reads).toBe(0);
  });
});
