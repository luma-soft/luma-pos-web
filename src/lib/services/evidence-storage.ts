export const SERVICE_EVIDENCE_BUCKET = "service-evidence";
export const MAX_SERVICE_EVIDENCE_BYTES = 15 * 1024 * 1024;
export const SERVICE_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
] as const;

export function safeServiceEvidenceName(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100) || "evidence";
}

export function sniffServiceEvidenceMime(
  bytes: Uint8Array,
  declared: string,
) {
  if (
    bytes[0] === 0xff
    && bytes[1] === 0xd8
    && bytes[2] === 0xff
  ) return "image/jpeg";
  if (
    bytes[0] === 0x89
    && bytes[1] === 0x50
    && bytes[2] === 0x4e
    && bytes[3] === 0x47
  ) return "image/png";
  if (
    bytes[0] === 0x52
    && bytes[1] === 0x49
    && bytes[2] === 0x46
    && bytes[3] === 0x46
    && bytes[8] === 0x57
    && bytes[9] === 0x45
    && bytes[10] === 0x42
    && bytes[11] === 0x50
  ) return "image/webp";
  if (
    bytes[0] === 0x25
    && bytes[1] === 0x50
    && bytes[2] === 0x44
    && bytes[3] === 0x46
  ) return "application/pdf";
  void declared;
  return null;
}
