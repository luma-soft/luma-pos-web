import * as XLSX from "xlsx";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { parseAiAttachmentWithProvider, type AiAttachmentParseResult } from "@/lib/ai/provider";
import { getAiAttachmentsBucket } from "@/lib/data/settings";
import type { MediaActor } from "@/lib/media/authorization";
import { getMediaService } from "@/lib/media/service";

export type AiAttachmentMetadata = {
  id?: string;
  mediaId?: string;
  bucket?: string;
  path?: string;
  name?: string;
  mimeType?: string;
  size?: number;
  kind?: "image" | "document";
};

export type ParsedAiAttachment = AiAttachmentMetadata & AiAttachmentParseResult;

function decodeText(bytes: Buffer) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
}

function parseCsv(bytes: Buffer): AiAttachmentParseResult {
  const text = decodeText(bytes).trim();
  return {
    provider: "none",
    status: "succeeded",
    extractedText: text.slice(0, 12000),
    candidates: [],
    confidence: text ? 0.7 : 0,
    unresolvedItems: [],
    warnings: text ? [] : ["CSV file is empty."],
  };
}

function parseXlsx(bytes: Buffer): AiAttachmentParseResult {
  const workbook = XLSX.read(bytes, { type: "buffer" });
  const rows: string[] = [];
  for (const sheetName of workbook.SheetNames.slice(0, 3)) {
    const sheet = workbook.Sheets[sheetName];
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false }).trim();
    if (csv) rows.push(`# ${sheetName}\n${csv}`);
  }
  const text = rows.join("\n\n").slice(0, 12000);
  return {
    provider: "none",
    status: "succeeded",
    extractedText: text,
    candidates: [],
    confidence: text ? 0.7 : 0,
    unresolvedItems: [],
    warnings: text ? [] : ["XLSX file has no readable rows."],
  };
}

function unsupportedResult(message: string): AiAttachmentParseResult {
  return {
    provider: "none",
    status: "unavailable",
    extractedText: "",
    candidates: [],
    confidence: 0,
    unresolvedItems: [],
    warnings: [message],
  };
}

async function defaultLegacyDownload(bucket: string, path: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase.storage.from(bucket).download(path);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}

export async function readAiAttachmentBytes(input: {
  attachment: AiAttachmentMetadata;
  actor: MediaActor;
  readManaged?: (actor: MediaActor, mediaId: string) => Promise<Uint8Array>;
  downloadLegacy?: (bucket: string, path: string) => Promise<Uint8Array>;
  getLegacyBucket?: (storeId: string) => Promise<string>;
}) {
  const {
    attachment,
    actor,
    readManaged = async (managedActor, mediaId) =>
      (await getMediaService().readMedia(managedActor, mediaId)).bytes,
    downloadLegacy = defaultLegacyDownload,
    getLegacyBucket = getAiAttachmentsBucket,
  } = input;
  if (attachment.mediaId) {
    return readManaged(actor, attachment.mediaId);
  }

  const configuredBucket = await getLegacyBucket(actor.storeId);
  const bucket = attachment.bucket || configuredBucket;
  const path = attachment.path || attachment.id;
  if (
    bucket !== configuredBucket
    || !path
    || !path.startsWith(`stores/${actor.storeId}/users/${actor.userId}/`)
  ) {
    throw new Error("ATTACHMENT_FORBIDDEN");
  }
  return downloadLegacy(bucket, path);
}

export async function parseAiAttachment(input: {
  attachment: AiAttachmentMetadata;
  actor: MediaActor;
  prompt?: string;
}): Promise<ParsedAiAttachment> {
  const { attachment, actor, prompt } = input;
  const mimeType = attachment.mimeType || "";
  let result: AiAttachmentParseResult;
  try {
    const bytes = Buffer.from(await readAiAttachmentBytes({ attachment, actor }));
    if (mimeType.startsWith("image/")) {
      result = await parseAiAttachmentWithProvider({
        storeId: actor.storeId,
        name: attachment.name || "image",
        mimeType,
        bytes,
        prompt,
      });
    } else if (mimeType === "text/csv") {
      result = parseCsv(bytes);
    } else if (mimeType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet") {
      result = parseXlsx(bytes);
    } else if (mimeType === "application/pdf") {
      result = unsupportedResult("PDF text extraction is not configured yet.");
    } else {
      result = unsupportedResult(`Unsupported attachment type: ${mimeType || "unknown"}.`);
    }
  } catch (error) {
    result = {
      provider: "none",
      status: "failed",
      extractedText: "",
      candidates: [],
      confidence: 0,
      unresolvedItems: [],
      warnings: [error instanceof Error ? error.message : "Attachment parse failed."],
    };
  }
  return {
    ...attachment,
    ...result,
  };
}

export function attachmentPromptBlock(parsed: ParsedAiAttachment[]) {
  const blocks = parsed.map((item, index) => {
    const candidates = item.candidates.length
      ? `\nCandidates:\n${item.candidates.map((candidate) => {
          const details = [
            candidate.sku ? `sku=${candidate.sku}` : "",
            candidate.unitName ? `unit=${candidate.unitName}` : "",
            candidate.unitCost != null ? `unitCost=${candidate.unitCost}` : "",
            candidate.grossUnitCost != null ? `grossUnitCost=${candidate.grossUnitCost}` : "",
            candidate.discount != null ? `discount=${candidate.discount}` : "",
            candidate.discountRate != null ? `discountRate=${candidate.discountRate}` : "",
            candidate.lineTotal != null ? `lineTotal=${candidate.lineTotal}` : "",
            `confidence=${Math.round(candidate.confidence * 100)}%`,
          ].filter(Boolean).join(" | ");
          return `- ${candidate.quantity ?? ""} ${candidate.text}${details ? ` | ${details}` : ""}`.trim();
        }).join("\n")}`
      : "";
    const warnings = item.warnings.length ? `\nWarnings: ${item.warnings.join("; ")}` : "";
    return [
      `Attachment ${index + 1}: ${item.name ?? item.id ?? "file"}`,
      `Type: ${item.mimeType ?? "unknown"}`,
      item.documentType ? `Document type: ${item.documentType}` : "",
      item.header ? `Header: ${JSON.stringify(item.header).slice(0, 1000)}` : "",
      `Confidence: ${Math.round(item.confidence * 100)}%`,
      item.extractedText ? `Extracted text:\n${item.extractedText}` : "Extracted text: ",
      candidates,
      warnings,
    ].filter(Boolean).join("\n");
  });
  return blocks.length ? `\n\n[AI attachment parse]\n${blocks.join("\n\n")}` : "";
}
