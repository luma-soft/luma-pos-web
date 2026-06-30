import type { PrintDocType } from "./template-shared";

export type ShareablePrintDocType = Extract<PrintDocType, "order" | "quote" | "booking">;

const FILE_PREFIX: Record<ShareablePrintDocType, string> = {
  order: "hoa-don",
  quote: "bao-gia",
  booking: "dat-hang",
};

export function buildPrintShareFileName(docType: ShareablePrintDocType, code: string, extension = "pdf") {
  const safeCode = code
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-_]+/g, "-")
    .replace(/^-+|-+$/g, "") || "phieu";

  return `${FILE_PREFIX[docType]}-${safeCode}.${extension}`;
}

export async function createPrintShareFile(): Promise<File | null> {
  // Placeholder for a future DOM-to-PDF exporter. Until then, share/open the
  // existing print URL so content always comes from the configured template.
  return null;
}
