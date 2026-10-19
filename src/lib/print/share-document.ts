import type { PrintDocType } from "./template-shared";

export type ShareablePrintDocType = Extract<PrintDocType, "order" | "quote" | "booking">;

const FILE_PREFIX: Record<PrintDocType, string> = {
  order: "hoa-don",
  quote: "bao-gia",
  booking: "dat-hang",
  purchase: "phieu-nhap",
  return: "phieu-tra-hang",
  receipt: "phieu-thu-chi",
};

export function buildPrintDocumentBaseName(docType: PrintDocType, code: string) {
  const safeCode = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "phieu";

  return `${FILE_PREFIX[docType]}-${safeCode}`;
}

export function buildPrintShareFileName(docType: ShareablePrintDocType, code: string, extension = "pdf") {
  return `${buildPrintDocumentBaseName(docType, code)}.${extension}`;
}

export async function createPrintShareFile(): Promise<File | null> {
  // Placeholder for a future DOM-to-PDF exporter. Until then, share/open the
  // existing print URL so content always comes from the configured template.
  return null;
}
