import type { MediaActor } from "@/lib/media/authorization";
import {
  createMediaLibraryItem,
  deleteMediaLibraryItem,
  getMediaLibrarySnapshot,
  mediaLibraryError,
  updateMediaLibraryItem,
} from "@/lib/media/library";
import type { MobileGate } from "@/lib/mobile/auth";
import { requireMobileUser } from "@/lib/mobile/auth";
import { mobileError, mobileOk, readJson } from "@/lib/mobile/response";

type AllowedGate = Extract<MobileGate, { ok: true }>;

function actorFromGate(gate: AllowedGate): MediaActor {
  return {
    storeId: gate.storeId,
    userId: gate.userId,
    role: gate.role,
    features: gate.features,
  };
}

type MediaLibraryRouteDependencies = {
  authenticate?: () => Promise<MobileGate>;
  list?: typeof getMediaLibrarySnapshot;
  create?: typeof createMediaLibraryItem;
  update?: typeof updateMediaLibraryItem;
  remove?: typeof deleteMediaLibraryItem;
};

export function createMediaLibraryHandlers(
  dependencies: MediaLibraryRouteDependencies = {},
) {
  const authenticate = dependencies.authenticate ?? requireMobileUser;

  async function gate() {
    const result = await authenticate();
    if (!result.ok) {
      return {
        actor: null,
        response: mobileError(
          result.error,
          result.error === "errors.unauthorized" ? 401 : 403,
        ),
      };
    }
    return { actor: actorFromGate(result), response: null };
  }

  return {
    GET: async function GET() {
      const authenticated = await gate();
      if (!authenticated.actor) return authenticated.response!;
      try {
        return mobileOk(await (dependencies.list ?? getMediaLibrarySnapshot)(
          authenticated.actor,
        ));
      } catch (error) {
        const mapped = mediaLibraryError(error);
        if (mapped.status === 500) console.error("list media library failed", error);
        return mobileError(mapped.error, mapped.status);
      }
    },
    POST: async function POST(request: Request) {
      const authenticated = await gate();
      if (!authenticated.actor) return authenticated.response!;
      try {
        const item = await (dependencies.create ?? createMediaLibraryItem)(
          authenticated.actor,
          await readJson(request),
        );
        return mobileOk(item);
      } catch (error) {
        const mapped = mediaLibraryError(error);
        if (mapped.status === 500) console.error("create media library item failed", error);
        return mobileError(mapped.error, mapped.status);
      }
    },
    PATCH: async function PATCH(request: Request) {
      const authenticated = await gate();
      if (!authenticated.actor) return authenticated.response!;
      try {
        const item = await (dependencies.update ?? updateMediaLibraryItem)(
          authenticated.actor,
          await readJson(request),
        );
        return mobileOk(item);
      } catch (error) {
        const mapped = mediaLibraryError(error);
        if (mapped.status === 500) console.error("update media library item failed", error);
        return mobileError(mapped.error, mapped.status);
      }
    },
    DELETE: async function DELETE(request: Request) {
      const authenticated = await gate();
      if (!authenticated.actor) return authenticated.response!;
      try {
        const id = new URL(request.url).searchParams.get("id") ?? "";
        return mobileOk(await (dependencies.remove ?? deleteMediaLibraryItem)(
          authenticated.actor,
          id,
        ));
      } catch (error) {
        const mapped = mediaLibraryError(error);
        if (mapped.status === 500) console.error("delete media library item failed", error);
        return mobileError(mapped.error, mapped.status);
      }
    },
  };
}

const handlers = createMediaLibraryHandlers();
export const GET = handlers.GET;
export const POST = handlers.POST;
export const PATCH = handlers.PATCH;
export const DELETE = handlers.DELETE;
