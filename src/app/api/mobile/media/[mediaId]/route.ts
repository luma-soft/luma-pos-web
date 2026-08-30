import type { MobileGate } from "@/lib/mobile/auth";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileOk } from "@/lib/mobile/response";
import {
  getMediaService,
  mediaServiceError,
  type MediaService,
} from "@/lib/media/service";

type MediaRouteDependencies = {
  authenticate?: () => Promise<MobileGate>;
  service?: MediaService;
};

type MediaRouteContext = { params: Promise<{ mediaId: string }> };

function gateError(gate: Exclude<MobileGate, { ok: true }>) {
  return mobileError(
    gate.error,
    gate.error === "errors.unauthorized" ? 401 : 403,
  );
}

export function createResolveMediaHandler(
  dependencies: MediaRouteDependencies = {},
) {
  return async function GET(_request: Request, context: MediaRouteContext) {
    const gate = await (dependencies.authenticate ?? requireMobileUser)();
    if (!gate.ok) return gateError(gate);
    try {
      const { mediaId } = await context.params;
      return mobileOk(
        await (dependencies.service ?? getMediaService()).resolveMedia(gate, mediaId),
      );
    } catch (error) {
      const mapped = mediaServiceError(error);
      if (mapped.status === 500) console.error("resolve media failed", error);
      return mobileError(mapped.error, mapped.status);
    }
  };
}

export function createDeleteMediaHandler(
  dependencies: MediaRouteDependencies = {},
) {
  return async function DELETE(_request: Request, context: MediaRouteContext) {
    const gate = await (dependencies.authenticate ?? requireMobileUser)();
    if (!gate.ok) return gateError(gate);
    try {
      const { mediaId } = await context.params;
      return mobileOk(
        await (dependencies.service ?? getMediaService()).deleteMedia(gate, mediaId),
      );
    } catch (error) {
      const mapped = mediaServiceError(error);
      if (mapped.status === 500) console.error("delete media failed", error);
      return mobileError(mapped.error, mapped.status);
    }
  };
}

export const GET = createResolveMediaHandler();
export const DELETE = createDeleteMediaHandler();
