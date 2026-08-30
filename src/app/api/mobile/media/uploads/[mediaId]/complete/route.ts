import type { MobileGate } from "@/lib/mobile/auth";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileOk } from "@/lib/mobile/response";
import {
  getMediaService,
  mediaServiceError,
  type MediaService,
} from "@/lib/media/service";

type CompleteUploadRouteDependencies = {
  authenticate?: () => Promise<MobileGate>;
  service?: MediaService;
};

type MediaRouteContext = { params: Promise<{ mediaId: string }> };

export function createCompleteUploadHandler(
  dependencies: CompleteUploadRouteDependencies = {},
) {
  return async function POST(_request: Request, context: MediaRouteContext) {
    const gate = await (dependencies.authenticate ?? requireMobileUser)();
    if (!gate.ok) {
      return mobileError(
        gate.error,
        gate.error === "errors.unauthorized" ? 401 : 403,
      );
    }
    try {
      const { mediaId } = await context.params;
      return mobileOk(
        await (dependencies.service ?? getMediaService()).completeUpload(gate, mediaId),
      );
    } catch (error) {
      const mapped = mediaServiceError(error);
      if (mapped.status === 500) console.error("complete media upload failed", error);
      return mobileError(mapped.error, mapped.status);
    }
  };
}

export const POST = createCompleteUploadHandler();
