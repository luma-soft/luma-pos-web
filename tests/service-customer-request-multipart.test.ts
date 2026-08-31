import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  CUSTOMER_REQUEST_MULTIPART_MAX_BYTES,
  parseCustomerRequestMultipart,
} from "../src/lib/services/customer-request-multipart";
import { sanitizeCustomerRequestEvidence } from "../src/lib/services/customer-request-portal";

const boundary = "----lumapos-customer-request-test";

function multipart(parts: Array<
  | { name: string; value: string }
  | { name: string; fileName: string; mimeType: string; bytes: Uint8Array }
>) {
  const chunks: Uint8Array[] = [];
  const encoder = new TextEncoder();
  for (const part of parts) {
    chunks.push(encoder.encode(`--${boundary}\r\n`));
    if ("fileName" in part) {
      chunks.push(encoder.encode(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.fileName}"\r\n`
        + `Content-Type: ${part.mimeType}\r\n\r\n`,
      ));
      chunks.push(part.bytes);
      chunks.push(encoder.encode("\r\n"));
    } else {
      chunks.push(encoder.encode(
        `Content-Disposition: form-data; name="${part.name}"\r\n\r\n${part.value}\r\n`,
      ));
    }
  }
  chunks.push(encoder.encode(`--${boundary}--\r\n`));
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}

function requestFromBytes(
  bytes: Uint8Array,
  options?: { contentLength?: string; chunkSize?: number },
) {
  const chunkSize = options?.chunkSize ?? bytes.length;
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= bytes.length) return controller.close();
      const end = Math.min(bytes.length, offset + chunkSize);
      const chunk = bytes.slice(offset, end);
      offset = end;
      controller.enqueue(chunk);
    },
  });
  const headers = new Headers({
    "content-type": `multipart/form-data; boundary=${boundary}`,
  });
  if (options?.contentLength) headers.set("content-length", options.contentLength);
  return new Request("http://localhost/api/portal/service-request/token", {
    method: "POST",
    headers,
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
}

const validFields = [
  { name: "title", value: "Camera offline" },
  { name: "description", value: "Camera at the front gate is offline" },
  { name: "contactName", value: "Customer" },
  { name: "contactPhone", value: "0900000000" },
  { name: "priority", value: "normal" },
] as const;

describe("customer request streaming multipart", () => {
  test("parses a normal chunked multipart request without Content-Length", async () => {
    const jpeg = await sharp({
      create: { width: 8, height: 8, channels: 3, background: "#42a5f5" },
    }).jpeg().toBuffer();
    const bytes = multipart([
      ...validFields,
      {
        name: "evidence",
        fileName: "camera.jpg",
        mimeType: "image/jpeg",
        bytes: jpeg,
      },
    ]);
    const parsed = await parseCustomerRequestMultipart(
      requestFromBytes(bytes, { chunkSize: 1024 }),
    );
    expect(parsed.fields.title).toBe("Camera offline");
    expect(parsed.files).toHaveLength(1);
    expect(parsed.files[0].fileName).toBe("camera.jpg");
    await expect(sanitizeCustomerRequestEvidence({
      bytes: parsed.files[0].bytes,
      declaredMimeType: parsed.files[0].mimeType,
      fileName: parsed.files[0].fileName,
    })).resolves.toMatchObject({ mimeType: "image/jpeg", width: 8, height: 8 });
    const route = readFileSync(
      new URL("../src/app/api/portal/service-request/[token]/route.ts", import.meta.url),
      "utf8",
    );
    expect(route).toContain("parseCustomerRequestMultipart(request)");
    expect(route).not.toContain("request.formData()");
  });

  test("rejects missing-length chunked bodies beyond the authoritative raw limit", async () => {
    const oversized = new Uint8Array(CUSTOMER_REQUEST_MULTIPART_MAX_BYTES + 1);
    await expect(parseCustomerRequestMultipart(
      requestFromBytes(oversized, { chunkSize: 64 * 1024 }),
    )).rejects.toThrow("CUSTOMER_REQUEST_MULTIPART_TOO_LARGE");
  });

  test("rejects forged low Content-Length when raw bytes exceed the limit", async () => {
    const oversized = new Uint8Array(CUSTOMER_REQUEST_MULTIPART_MAX_BYTES + 1);
    await expect(parseCustomerRequestMultipart(
      requestFromBytes(oversized, { contentLength: "10", chunkSize: 32 * 1024 }),
    )).rejects.toThrow("CUSTOMER_REQUEST_MULTIPART_TOO_LARGE");
  });

  test("rejects oversized unexpected file fields instead of ignoring them", async () => {
    const bytes = multipart([
      ...validFields,
      {
        name: "avatar",
        fileName: "payload.bin",
        mimeType: "application/octet-stream",
        bytes: new Uint8Array(8 * 1024 * 1024 + 1),
      },
    ]);
    await expect(parseCustomerRequestMultipart(
      requestFromBytes(bytes, { chunkSize: 16 * 1024 }),
    )).rejects.toThrow("CUSTOMER_REQUEST_MULTIPART_INVALID");
  });

  test("rejects duplicate controls, excess fields, and excess parts", async () => {
    await expect(parseCustomerRequestMultipart(requestFromBytes(multipart([
      ...validFields,
      { name: "priority", value: "urgent" },
    ])))).rejects.toThrow("CUSTOMER_REQUEST_MULTIPART_INVALID");
    await expect(parseCustomerRequestMultipart(requestFromBytes(multipart([
      ...validFields,
      { name: "extra", value: "unexpected" },
    ])))).rejects.toThrow("CUSTOMER_REQUEST_MULTIPART_INVALID");
    await expect(parseCustomerRequestMultipart(requestFromBytes(multipart([
      ...validFields,
      ...Array.from({ length: 4 }, (_, index) => ({
        name: "evidence",
        fileName: `camera-${index}.jpg`,
        mimeType: "image/jpeg",
        bytes: Uint8Array.from([0xff, 0xd8, 0xff, 0xd9]),
      })),
    ])))).rejects.toThrow("CUSTOMER_REQUEST_MULTIPART_INVALID");
  });

  test("stores public portal evidence through an exact project-scoped managed-media capability", () => {
    const route = readFileSync(
      new URL("../src/app/api/portal/service-request/[token]/route.ts", import.meta.url),
      "utf8",
    );

    expect(route).toContain("createDatabaseMediaRepository");
    expect(route).toContain("forceCreatedByNull: true");
    expect(route).toContain("putManagedObject");
    expect(route).toContain('purpose: "project-document"');
    expect(route).toContain("mediaObjectId");
    expect(route).toContain("compensateManagedMediaAssociation");
    expect(route).toContain("expectedObjectKey: object.path");
    expect(route).toContain("expectedCreatedBy: null");
    expect(route).toContain("customer request media recovery did not reach a safe state");
    expect(route).not.toContain("createSupabaseAdminClient");
    expect(route).not.toContain("stageCustomerRequestStorageCleanupCore");
  });

  test("manager attachment reads preserve the ten-minute legacy URL envelope across providers", () => {
    const route = readFileSync(
      new URL(
        "../src/app/api/mobile/services/customer-requests/[id]/attachments/[attachmentId]/route.ts",
        import.meta.url,
      ),
      "utf8",
    );

    expect(route).toContain("eq(serviceCustomerRequestAttachments.storeId, gate.storeId)");
    expect(route).toContain("mediaPurpose: mediaObjects.purpose");
    expect(route).toContain("mediaTargetId: mediaObjects.targetId");
    expect(route).toContain("mediaDomain: mediaObjects.domain");
    expect(route).toContain("mediaObjectId");
    expect(route).toContain("resolveManagedPrivateMediaUrl");
    expect(route).toContain("expectedPurpose: attachment.mediaPurpose!");
    expect(route).toContain("expectedTargetId: attachment.mediaTargetId!");
    expect(route).toContain("authorizeTarget: async");
    expect(route).not.toContain("attachment.linkedJobId");
    expect(route).toContain('getObjectStorage("supabase")');
    expect(route).toContain("expiresInSeconds: 10 * 60");
    expect(route).toContain("mobileOk({ url, expiresIn: 600 })");
  });
});
