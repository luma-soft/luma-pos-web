import Busboy from "busboy";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES } from "@/lib/services/customer-request-portal";

export const SERVICE_WARRANTY_MULTIPART_MAX_BYTES =
  CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES + 64 * 1024;

const CONTROL_FIELDS = new Set([
  "jobId",
  "assetId",
  "title",
  "description",
  "priority",
  "scheduledAt",
]);
const REQUIRED_FIELDS = ["jobId", "assetId", "title", "priority"] as const;

export type ParsedTechnicianWarrantyMultipart = {
  fields: Record<string, string>;
  file: {
    fileName: string;
    mimeType: string;
    bytes: Uint8Array;
  } | null;
};

function multipartError(code = "SERVICE_WARRANTY_MULTIPART_INVALID") {
  return new Error(code);
}

export async function parseTechnicianWarrantyMultipart(
  request: Request,
): Promise<ParsedTechnicianWarrantyMultipart> {
  if (!request.body) throw multipartError();
  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: {
        "content-type": request.headers.get("content-type") ?? "",
      },
      limits: {
        fileSize: CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES,
        files: 1,
        fields: 7,
        fieldNameSize: 30,
        fieldSize: 4_000,
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
      callback(
        rawBytes > SERVICE_WARRANTY_MULTIPART_MAX_BYTES
          ? multipartError("SERVICE_WARRANTY_MULTIPART_TOO_LARGE")
          : null,
        chunk,
      );
    },
  });
  const fields: Record<string, string> = {};
  let parsedFile: ParsedTechnicianWarrantyMultipart["file"] = null;
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
    if (name !== "file" || !info.filename || parsedFile) {
      file.resume();
      invalidate();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let truncated = false;
    file.on("limit", () => {
      truncated = true;
      invalidate("SERVICE_WARRANTY_MULTIPART_TOO_LARGE");
    });
    file.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > CUSTOMER_REQUEST_EVIDENCE_MAX_BYTES) {
        truncated = true;
        invalidate("SERVICE_WARRANTY_MULTIPART_TOO_LARGE");
        return;
      }
      chunks.push(chunk);
    });
    file.on("end", () => {
      if (truncated || validationError) return;
      parsedFile = {
        fileName: info.filename,
        mimeType: info.mimeType,
        bytes: new Uint8Array(Buffer.concat(chunks, size)),
      };
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
        candidate.message === "SERVICE_WARRANTY_MULTIPART_TOO_LARGE"
        || candidate.message === "SERVICE_WARRANTY_MULTIPART_INVALID"
      )
    ) throw candidate;
    throw multipartError();
  } finally {
    if (!source.destroyed) source.destroy();
    if (!limiter.destroyed) limiter.destroy();
    if (!parser.destroyed) parser.destroy();
  }
  if (validationError) throw validationError;
  if (REQUIRED_FIELDS.some((field) => !Object.hasOwn(fields, field))) {
    throw multipartError();
  }
  return { fields, file: parsedFile };
}
