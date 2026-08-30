import { expect, test } from "bun:test";
import {
  SERVICE_WARRANTY_MULTIPART_MAX_BYTES,
  parseTechnicianWarrantyMultipart,
} from "@/lib/services/technician-warranty-multipart";

function requestWith(form: FormData) {
  return new Request("https://example.test/api/mobile/services/warranty-claims", {
    method: "POST",
    body: form,
  });
}

test("streams one bounded private evidence file and strict control fields", async () => {
  const form = new FormData();
  form.set("jobId", "11111111-1111-4111-8111-111111111111");
  form.set("assetId", "22222222-2222-4222-8222-222222222222");
  form.set("title", "Camera offline");
  form.set("description", "No image");
  form.set("priority", "high");
  form.set("scheduledAt", "");
  form.set("file", new File([
    new Uint8Array([0xff, 0xd8, 0xff, 0xdb]),
  ], "issue.jpg", { type: "image/jpeg" }));
  const parsed = await parseTechnicianWarrantyMultipart(requestWith(form));
  expect(parsed.fields.title).toBe("Camera offline");
  expect(parsed.file?.fileName).toBe("issue.jpg");
});

test("rejects oversized total streams without trusting content-length", async () => {
  const boundary = "warranty-limit";
  const bytes = new Uint8Array(SERVICE_WARRANTY_MULTIPART_MAX_BYTES + 1);
  const request = new Request("https://example.test", {
    method: "POST",
    headers: {
      "content-type": `multipart/form-data; boundary=${boundary}`,
      "content-length": "1",
    },
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    duplex: "half",
  } as RequestInit);
  await expect(parseTechnicianWarrantyMultipart(request)).rejects.toThrow(
    "SERVICE_WARRANTY_MULTIPART_TOO_LARGE",
  );
});

test("stores warranty evidence as managed private R2 media in the claim transaction", async () => {
  const source = await Bun.file(
    `${process.cwd()}/src/app/api/mobile/services/warranty-claims/route.ts`,
  ).text();
  expect(source).toContain("putManagedObject");
  expect(source).toContain("requireReadyManagedMediaInTransaction");
  expect(source).toContain("mediaObjectId");
  expect(source).toContain("compensateManagedMediaAssociation");
  expect(source).toContain("managedError.status === 403");
  expect(source).toContain('mobileError("errors.notFound", 404)');
  expect(source).not.toContain("createSupabaseAdminClient");
  expect(source).not.toContain("stageServiceStorageCleanupCore");
});

test("warranty detail dual-reads private evidence with the legacy attachment shape", async () => {
  const source = await Bun.file(
    `${process.cwd()}/src/app/api/mobile/services/warranty-claims/[id]/route.ts`,
  ).text();

  expect(source).toContain("eq(warrantyClaims.storeId, gate.storeId)");
  expect(source).toContain("mediaObjectId");
  expect(source).toContain("resolveManagedPrivateMediaUrl");
  expect(source).toContain("projectId: serviceAttachments.projectId");
  expect(source).toContain("jobId: serviceAttachments.jobId");
  expect(source).toContain('purpose: "service-evidence" as const');
  expect(source).toContain('purpose: "project-document" as const');
  expect(source).toContain("expectedPurpose: mediaTarget.purpose");
  expect(source).toContain("expectedTargetId: mediaTarget.targetId");
  expect(source).toContain("authorizeTarget: async");
  expect(source).not.toContain("expectedTargetId: result.claim.jobId");
  expect(source).toContain('getObjectStorage("supabase")');
  expect(source).toContain("expiresInSeconds: 15 * 60");
  expect(source).toContain("return { ...attachment, signedUrl }");
});
