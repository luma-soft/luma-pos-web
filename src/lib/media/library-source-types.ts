import { z } from "zod";

import { canonicalUuidCoordinateSchema } from "@/lib/media/uuid-coordinate";

export const mediaLibraryPresetSchema = z.enum([
  "products", "camera", "electrical", "plumbing", "mixed",
]);

export type MediaLibraryPreset = z.infer<typeof mediaLibraryPresetSchema>;

export const MEDIA_LIBRARY_PRESETS: ReadonlyArray<{ source: MediaLibraryPreset; name: string; key: string }> = [
  { source: "products", name: "Hàng hóa", key: "auto:products" },
  { source: "camera", name: "Thi công camera", key: "auto:camera" },
  { source: "electrical", name: "Thi công điện", key: "auto:electrical" },
  { source: "plumbing", name: "Thi công nước", key: "auto:plumbing" },
  { source: "mixed", name: "Thi công tổng hợp", key: "auto:mixed" },
];

export type MediaLibrarySource = {
  type: "product" | "project" | "job" | "asset";
  id: string;
  label: string;
  projectId?: string;
};

// These are association coordinates, not media IDs: authorization must be
// checked against the current source each time a linked item is resolved.
const linkedItemIdSchema = z.string().max(80).refine((value) => {
  const parts = value.split(":");
  if (parts[0] === "pm" || parts[0] === "sa") {
    return parts.length === 2 && canonicalUuidCoordinateSchema.safeParse(parts[1]).success;
  }
  return parts[0] === "pu" && parts.length === 3
    && canonicalUuidCoordinateSchema.safeParse(parts[1]).success
    && /^[a-f0-9]{32}$/i.test(parts[2]);
}).transform((value) => value.toLowerCase());

export const mediaLibraryItemIdSchema = z.union([
  canonicalUuidCoordinateSchema,
  linkedItemIdSchema,
]);
