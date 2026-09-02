import { z } from "zod";
import { canonicalUuidCoordinateSchema } from "@/lib/media/uuid-coordinate";
import {
  LIBRARY_VIDEO_MAX_BYTES,
  mediaLibraryMaxBytesForMime,
} from "@/lib/media/library-schema";

export const MEDIA_PURPOSES = {
  "product-image": {
    domain: "products",
    visibility: "public",
    maxBytes: 10 * 1024 * 1024,
    mime: /^image\//,
  },
  "project-document": {
    domain: "projects",
    visibility: "private",
    maxBytes: 25 * 1024 * 1024,
    mime: /^(image\/|application\/pdf$|application\/vnd\.)/,
  },
  "service-evidence": {
    domain: "service-evidence",
    visibility: "private",
    maxBytes: 15 * 1024 * 1024,
    mime: /^(image\/|application\/pdf$)/,
  },
  "ai-attachment": {
    domain: "ai",
    visibility: "private",
    maxBytes: 15 * 1024 * 1024,
    mime: /^(image\/|application\/pdf$|text\/)/,
  },
  "library-asset": {
    domain: "library",
    visibility: "private",
    maxBytes: LIBRARY_VIDEO_MAX_BYTES,
    mime: /^(image\/|video\/|application\/|text\/)/,
  },
} as const;

export type MediaPurpose = keyof typeof MEDIA_PURPOSES;

const MIME_EXTENSIONS = {
  "image/avif": "avif",
  "image/gif": "gif",
  "image/heic": "heic",
  "image/heif": "heif",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.ms-excel": "xls",
  "application/vnd.ms-powerpoint": "ppt",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "text/csv": "csv",
  "text/plain": "txt",
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-m4v": "m4v",
} as const;

export type ManagedMediaMimeType = keyof typeof MIME_EXTENSIONS;

export function normalizeMediaType(value: string): string {
  return value.trim().toLowerCase();
}

export function extensionForMediaType(value: string): string | null {
  return MIME_EXTENSIONS[normalizeMediaType(value) as ManagedMediaMimeType] ?? null;
}

const baseUploadIntentSchema = z.object({
  purpose: z.enum([
    "product-image",
    "project-document",
    "service-evidence",
    "ai-attachment",
    "library-asset",
  ]),
  targetId: canonicalUuidCoordinateSchema,
  fileName: z.string()
    .trim()
    .min(1)
    .max(255)
    .refine((value) => !/[\\/\u0000-\u001f\u007f]/.test(value)),
  mimeType: z.string().trim().min(1).max(160)
    .transform(normalizeMediaType),
  sizeBytes: z.number().int().safe().positive(),
});

export const uploadIntentSchema = baseUploadIntentSchema.superRefine((input, context) => {
  const policy = MEDIA_PURPOSES[input.purpose];
  const extension = extensionForMediaType(input.mimeType);
  if (
    !extension
    || !policy.mime.test(input.mimeType)
    || input.mimeType === "image/svg+xml"
  ) {
    context.addIssue({
      code: "custom",
      path: ["mimeType"],
      message: "Unsupported media type",
    });
  }
  if (input.sizeBytes > policy.maxBytes) {
    context.addIssue({
      code: "too_big",
      origin: "number",
      maximum: policy.maxBytes,
      inclusive: true,
      path: ["sizeBytes"],
      message: "Media exceeds the purpose limit",
    });
  }
  if (input.purpose === "library-asset") {
    const maxBytes = mediaLibraryMaxBytesForMime(input.mimeType);
    if (maxBytes === null) {
      context.addIssue({
        code: "custom",
        path: ["mimeType"],
        message: "Unsupported library media type",
      });
    } else if (input.sizeBytes > maxBytes) {
      context.addIssue({
        code: "too_big",
        origin: "number",
        maximum: maxBytes,
        inclusive: true,
        path: ["sizeBytes"],
        message: "Library media exceeds its type limit",
      });
    }
  }
});

export type UploadIntentInput = z.infer<typeof uploadIntentSchema>;

export const mediaIdSchema = canonicalUuidCoordinateSchema;
