import { z } from "zod";

import { mediaIdSchema } from "@/lib/media/schemas";

export const MAX_PRODUCT_IMAGES = 10;

export const imageMediaIdsSchema = z.array(mediaIdSchema)
  .max(MAX_PRODUCT_IMAGES)
  .superRefine((ids, context) => {
    const seen = new Set<string>();
    for (const [index, id] of ids.entries()) {
      if (seen.has(id)) {
        context.addIssue({
          code: "custom",
          path: [index],
          message: "products.errors.duplicateImage",
        });
      }
      seen.add(id);
    }
  });
