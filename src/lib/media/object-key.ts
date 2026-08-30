const MEDIA_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MEDIA_DOMAIN_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ALLOWED_EXTENSIONS = new Set([
  "avif",
  "csv",
  "doc",
  "docx",
  "gif",
  "heic",
  "heif",
  "jpeg",
  "jpg",
  "pdf",
  "png",
  "ppt",
  "pptx",
  "txt",
  "webp",
  "xls",
  "xlsx",
]);

export function createObjectKey(input: {
  storeId: string;
  domain: string;
  mediaId: string;
  fileName: string;
  now?: Date;
}): string {
  if (!MEDIA_ID_PATTERN.test(input.storeId)) {
    throw new Error("Store ID must be a UUID");
  }
  if (!MEDIA_ID_PATTERN.test(input.mediaId)) {
    throw new Error("Media ID must be a UUID");
  }
  if (!MEDIA_DOMAIN_PATTERN.test(input.domain)) {
    throw new Error("Media domain is invalid");
  }

  const extension = input.fileName.split(".").at(-1)?.toLowerCase() ?? "";
  if (!ALLOWED_EXTENSIONS.has(extension)) {
    throw new Error("Unsupported media file extension");
  }

  const now = input.now ?? new Date();
  if (Number.isNaN(now.getTime())) {
    throw new Error("Object key date is invalid");
  }

  return [
    "stores",
    input.storeId,
    input.domain,
    String(now.getUTCFullYear()),
    String(now.getUTCMonth() + 1).padStart(2, "0"),
    input.mediaId,
    `original.${extension}`,
  ].join("/");
}
