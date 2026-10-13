import { NextResponse } from "next/server";

import { createMediaBrowserPreview } from "@/lib/media/image-variants";
import {
  getMediaService,
  mediaServiceError,
  type MediaService,
} from "@/lib/media/service";
import { requireMobileUser, type MobileGate } from "@/lib/mobile/auth";
import { mobileError } from "@/lib/mobile/response";

type RouteContext = { params: Promise<{ mediaId: string }> };

export const runtime = "nodejs";
const MAX_PREVIEW_SOURCE_BYTES = 25 * 1024 * 1024;

export function createMediaBrowserPreviewHandler(dependencies: {
  authenticate?: () => Promise<MobileGate>;
  service?: Pick<MediaService, "resolveMedia">;
  fetchMedia?: typeof fetch;
} = {}) {
  return async function GET(request: Request, context: RouteContext) {
    const gate = await (dependencies.authenticate ?? requireMobileUser)();
    if (!gate.ok) {
      return mobileError(
        gate.error,
        gate.error === "errors.unauthorized" ? 401 : 403,
      );
    }

    try {
      const { mediaId } = await context.params;
      const media = await (dependencies.service ?? getMediaService())
        .resolveMedia(gate, mediaId);
      const mimeType = media.mimeType.trim().toLowerCase();
      if (!["image/heic", "image/heif"].includes(mimeType)) {
        return mobileError("errors.invalidData", 415);
      }
      if (media.sizeBytes > MAX_PREVIEW_SOURCE_BYTES) {
        return mobileError("errors.invalidData", 413);
      }

      const requestedSize = new URL(request.url).searchParams.get("size");
      if (requestedSize && requestedSize !== "thumbnail" && requestedSize !== "full") {
        return mobileError("errors.invalidData", 400);
      }
      const thumbnail = requestedSize === "thumbnail";
      const source = await (dependencies.fetchMedia ?? fetch)(media.url, {
        cache: "no-store",
      });
      const contentLength = Number(source.headers.get("Content-Length"));
      if (!source.ok || !source.body || (Number.isFinite(contentLength)
          && contentLength > MAX_PREVIEW_SOURCE_BYTES)) {
        throw new Error("Media source unavailable for preview");
      }
      const bytes = new Uint8Array(await source.arrayBuffer());
      if (bytes.byteLength > MAX_PREVIEW_SOURCE_BYTES) {
        return mobileError("errors.invalidData", 413);
      }
      const preview = await createMediaBrowserPreview(bytes, mimeType, {
        maxDimension: thumbnail ? 640 : 2560,
        quality: thumbnail ? 78 : 84,
      });

      return new NextResponse(Buffer.from(preview), {
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Type": "image/webp",
          "X-Content-Type-Options": "nosniff",
        },
      });
    } catch (error) {
      const mapped = mediaServiceError(error);
      if (mapped.status === 500) console.error("media browser preview failed");
      return mobileError(mapped.error, mapped.status);
    }
  };
}

export const GET = createMediaBrowserPreviewHandler();
