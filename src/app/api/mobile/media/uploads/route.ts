import type { MobileGate } from "@/lib/mobile/auth";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileOk, readJson } from "@/lib/mobile/response";
import {
  getMediaService,
  mediaServiceError,
  type MediaService,
} from "@/lib/media/service";

type UploadIntentRouteDependencies = {
  authenticate?: () => Promise<MobileGate>;
  service?: MediaService;
};

export function createUploadIntentHandler(
  dependencies: UploadIntentRouteDependencies = {},
) {
  return async function POST(request: Request) {
    const gate = await (dependencies.authenticate ?? requireMobileUser)();
    if (!gate.ok) {
      return mobileError(
        gate.error,
        gate.error === "errors.unauthorized" ? 401 : 403,
      );
    }
    try {
      const data = await (dependencies.service ?? getMediaService())
        .createUploadIntent(gate, await readJson(request));
      return mobileOk(data);
    } catch (error) {
      const mapped = mediaServiceError(error);
      if (mapped.status === 500) console.error("create media upload intent failed", error);
      return mobileError(mapped.error, mapped.status);
    }
  };
}

export const POST = createUploadIntentHandler();
