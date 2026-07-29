import Busboy from "busboy";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES } from "@/lib/services/customer-request-portal";

export const CUSTOMER_REQUEST_MULTIPART_MAX_BYTES =
  3 * CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES + 256 * 1024;

const CONTROL_FIELDS = new Set([
  "title",
  "description",
  "contactName",
  "contactPhone",
  "priority",
]);

export type ParsedCustomerRequestMultipart = {
  fields: Record<string, string>;
  files: Array<{
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  }>;
};

function multipartError(code = "CUSTOMER_REQUEST_MULTIPART_INVALID") {
  return new Error(code);
}

export async function parseCustomerRequestMultipart(
  request: Request,
): Promise<ParsedCustomerRequestMultipart> {
  if (!request.body) throw multipartError();
  const contentType = request.headers.get("content-type") ?? "";
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: { "content-type": contentType },
      limits: {
        fileSize: CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES,
        files: 3,
        fields: 5,
        fieldNameSize: 30,
        fieldSize: 5_000,
        parts: 8,
        headerPairs: 20,
      },
    });
  } catch {
    throw multipartError();
  }

  const source = Readable.fromWeb(request.body as never);
  let rawBytes = 0;
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      rawBytes += chunk.length;
      if (rawBytes > CUSTOMER_REQUEST_MULTIPART_MAX_BYTES) {
        callback(multipartError("CUSTOMER_REQUEST_MULTIPART_TOO_LARGE"));
        return;
      }
      callback(null, chunk);
    },
  });
  const fields: Record<string, string> = {};
  const files: ParsedCustomerRequestMultipart["files"] = [];
  let validationError: Error | null = null;

  function invalidate(code?: string) {
    if (validationError) return;
    validationError = multipartError(code);
    source.destroy();
    limiter.destroy();
  }

  parser.on("field", (name, value, info) => {
    if (
      !CONTROL_FIELDS.has(name)
      || Object.hasOwn(fields, name)
      || info.nameTruncated
      || info.valueTruncated
    ) {
      invalidate();
      return;
    }
    fields[name] = value;
  });
  parser.on("file", (name, file, info) => {
    file.on("error", () => undefined);
    if (name !== "evidence" || !info.filename || files.length >= 3) {
      file.resume();
      invalidate();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    file.on("limit", () => {
      truncated = true;
      invalidate("CUSTOMER_REQUEST_MULTIPART_TOO_LARGE");
    });
    file.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES) {
        truncated = true;
        invalidate("CUSTOMER_REQUEST_MULTIPART_TOO_LARGE");
        return;
      }
      chunks.push(chunk);
    });
    file.on("end", () => {
      if (truncated || validationError) return;
      files.push({
        fileName: info.filename,
        mimeType: info.mimeType,
        bytes: new Uint8Array(Buffer.concat(chunks, size)),
      });
    });
  });
  for (const event of ["filesLimit", "fieldsLimit", "partsLimit"] as const) {
    parser.on(event, () => invalidate());
  }

  try {
    await pipeline(source, limiter, parser);
  } catch (error) {
    const candidate = validationError ?? error;
    if (
      candidate instanceof Error
      && (
        candidate.message === "CUSTOMER_REQUEST_MULTIPART_TOO_LARGE"
        || candidate.message === "CUSTOMER_REQUEST_MULTIPART_INVALID"
      )
    ) throw candidate;
    throw multipartError();
  } finally {
    if (!source.destroyed) source.destroy();
    if (!limiter.destroyed) limiter.destroy();
    if (!parser.destroyed) parser.destroy();
  }
  if (validationError) throw validationError;
  const missingControl = [...CONTROL_FIELDS].find((field) => !Object.hasOwn(fields, field));
  if (missingControl) {
    throw multipartError();
  }
  return { fields, files };
}
