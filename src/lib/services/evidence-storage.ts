export const SERVICE_EVIDENCE_BUCKET = "service-evidence";
export const MAX_SERVICE_EVIDENCE_BYTES = 15 * 1024 * 1024;
export const SERVICE_EVIDENCE_MIME_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
] as const;

export function serviceEvidenceDeclaredMime(
  fileName: string,
  declared: string,
) {
  const normalized = declared.trim().toLowerCase();
  if (SERVICE_EVIDENCE_MIME_TYPES.includes(
    normalized as (typeof SERVICE_EVIDENCE_MIME_TYPES)[number],
  )) {
    return normalized;
  }
  const extension = fileName.trim().toLowerCase().split(".").pop();
  return ({
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    heic: "image/heic",
    heif: "image/heif",
    pdf: "application/pdf",
  } as Record<string, string>)[extension ?? ""] ?? normalized;
}

export function serviceEvidencePhotoCapacity(
  currentCount: number,
  incomingCount: number,
) {
  const available = Math.max(0, 8 - Math.max(0, currentCount));
  const normalizedIncoming = Math.max(0, incomingCount);
  const acceptedCount = Math.min(available, normalizedIncoming);
  const overflowCount = Math.max(0, normalizedIncoming - acceptedCount);
  return {
    acceptedCount,
    overflowCount,
    message: overflowCount > 0
      ? `Mỗi thiết bị tối đa 8 ảnh. Đã bỏ qua ${overflowCount} ảnh vượt giới hạn.`
      : "",
  };
}

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
  if (
    bytes[4] === 0x66
    && bytes[5] === 0x74
    && bytes[6] === 0x79
    && bytes[7] === 0x70
  ) {
    const majorBrand = String.fromCharCode(
      bytes[8] ?? 0,
      bytes[9] ?? 0,
      bytes[10] ?? 0,
      bytes[11] ?? 0,
    );
    if (["heic", "heix", "hevc", "hevx"].includes(majorBrand)) {
      return "image/heic";
    }
    if (["mif1", "msf1"].includes(majorBrand)) {
      return "image/heif";
    }
  }
  void declared;
  return null;
}
