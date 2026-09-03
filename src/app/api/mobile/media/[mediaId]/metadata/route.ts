import type { MobileGate } from "@/lib/mobile/auth";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileOk } from "@/lib/mobile/response";
import { getMediaService, mediaServiceError, type MediaService } from "@/lib/media/service";

export function createExtractMetadataHandler(dependencies: {
  authenticate?: () => Promise<MobileGate>;
  service?: Pick<MediaService, "extractMetadata">;
} = {}) {
  return async function POST(_request: Request, context: { params: Promise<{ mediaId: string }> }) {
    const gate = await (dependencies.authenticate ?? requireMobileUser)();
    if (!gate.ok) return mobileError(gate.error, gate.error === "errors.unauthorized" ? 401 : 403);
    try {
      const { mediaId } = await context.params;
      const result = await (dependencies.service ?? getMediaService()).extractMetadata(gate, mediaId);
      const response = mobileOk(result);
      response.headers.set("Cache-Control", "private, no-store");
      return response;
    } catch (error) {
      const mapped = mediaServiceError(error);
      return mobileError(mapped.error, mapped.status);
    }
  };
}

export const POST = createExtractMetadataHandler();
