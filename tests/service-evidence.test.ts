import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  canonicalizeSignedDocument,
  hashSignedDocument,
} from "../src/lib/services/evidence";
import {
  safeServiceEvidenceName,
  sniffServiceEvidenceMime,
} from "../src/lib/services/evidence-storage";

describe("service signature evidence", () => {
  test("canonical document output is stable across object key order", () => {
    const first = canonicalizeSignedDocument({
      jobId: "job-1",
      content: { accepted: true, note: "Bàn giao đủ" },
    });
    const second = canonicalizeSignedDocument({
      content: { note: "Bàn giao đủ", accepted: true },
      jobId: "job-1",
    });

    expect(first).toBe(second);
    expect(hashSignedDocument(first)).toBe(hashSignedDocument(second));
  });

  test("document hash changes when signed content changes", () => {
    const first = hashSignedDocument(canonicalizeSignedDocument({ jobId: "job-1", accepted: true }));
    const second = hashSignedDocument(canonicalizeSignedDocument({ jobId: "job-1", accepted: false }));

    expect(first).not.toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("service evidence upload policy", () => {
  test("normalizes file names and verifies magic bytes", () => {
    expect(safeServiceEvidenceName("Ảnh trước lắp đặt.JPG")).toBe("Anh-truoc-lap-dat.JPG");
    expect(sniffServiceEvidenceMime(
      new Uint8Array([0xff, 0xd8, 0xff, 0x00]),
      "image/jpeg",
    )).toBe("image/jpeg");
    expect(sniffServiceEvidenceMime(
      new Uint8Array([0x25, 0x50, 0x44, 0x46]),
      "application/pdf",
    )).toBe("application/pdf");
  });

  test("rejects a declared image whose bytes do not match", () => {
    expect(sniffServiceEvidenceMime(
      new Uint8Array([0x00, 0x01, 0x02, 0x03]),
      "image/jpeg",
    )).toBeNull();
  });
});

describe("service evidence managed-media route contract", () => {
  test("writes new job evidence through MediaService and records the canonical media id", () => {
    const source = readFileSync(
      "src/app/api/mobile/services/jobs/[id]/attachments/route.ts",
      "utf8",
    );
    const post = source.slice(source.indexOf("export async function POST"), source.indexOf("export async function DELETE"));

    expect(post).toContain("getMediaService");
    expect(post).toContain("putManagedObject");
    expect(post).toContain("mediaObjectId");
    expect(post).toContain("requireReadyManagedMediaInTransaction");
    expect(post).toContain("compensateManagedMediaAssociation");
    expect(post).toContain("expectedObjectKey: managed.path");
    expect(post).toContain("expectedCreatedBy: gate.userId");
    expect(post).toContain("mediaServiceError(error)");
    expect(post).not.toContain(".storage.from(");
  });

  test("dual-reads job evidence and logically deletes managed media without synchronous R2 removal", () => {
    const collection = readFileSync(
      "src/app/api/mobile/services/jobs/[id]/attachments/route.ts",
      "utf8",
    );
    const item = readFileSync(
      "src/app/api/mobile/services/jobs/[id]/attachments/[attachmentId]/route.ts",
      "utf8",
    );

    expect(item).toContain("mediaObjectId");
    expect(item).toContain("resolveManagedPrivateMediaUrl");
    expect(item).toContain("15 * 60");
    expect(item).toContain("eq(serviceJobs.storeId, gate.storeId)");
    expect(item).toContain("eq(serviceAttachments.storeId, gate.storeId)");
    expect(collection).toContain("eq(serviceJobs.storeId, gate.storeId)");
    expect(collection).toContain("eq(serviceAttachments.storeId, gate.storeId)");
    expect(collection).toContain("softDeleteMediaIfUnreferencedInTransaction");
    expect(collection).toContain("completeServiceEvidenceStorageRemoval");
  });
});
