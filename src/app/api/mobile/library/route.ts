import { NextResponse } from "next/server";
import type { MediaActor } from "@/lib/media/authorization";
import {
  createMediaLibraryItem,
  extractMediaLibraryMetadata,
  deleteMediaLibraryItem,
  deleteMediaLibraryItems,
  getMediaLibrarySnapshot,
  mediaLibraryError,
  resolveMediaLibraryItem,
  updateMediaLibraryItem,
} from "@/lib/media/library";
import { MediaLibraryQueryError, parseMediaLibraryQuery } from "@/lib/media/library-query";
import type { MobileGate } from "@/lib/mobile/auth";
import { requireMobileUser } from "@/lib/mobile/auth";
import { isMobileEntityId } from "@/lib/mobile/exact-entity";
import { mobileError, mobileOk, readJson } from "@/lib/mobile/response";

type AllowedGate = Extract<MobileGate, { ok: true }>;

function attachmentFileName(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

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
  resolve?: typeof resolveMediaLibraryItem;
  create?: typeof createMediaLibraryItem;
  extractMetadata?: typeof extractMediaLibraryMetadata;
  update?: typeof updateMediaLibraryItem;
  remove?: typeof deleteMediaLibraryItem;
  removeMany?: typeof deleteMediaLibraryItems;
  fetchMedia?: typeof fetch;
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
    GET: async function GET(request?: Request) {
      const authenticated = await gate();
      if (!authenticated.actor) return authenticated.response!;
      try {
        const params = request ? new URL(request.url).searchParams : new URLSearchParams();
        if (params.has("resolve") || params.has("open") || params.has("download")) {
          if (params.getAll("resolve").length + params.getAll("open").length + params.getAll("download").length !== 1) throw new MediaLibraryQueryError();
          const candidateId = params.get("resolve") ?? params.get("open") ?? params.get("download") ?? "";
          const item = await (dependencies.resolve ?? resolveMediaLibraryItem)(
            authenticated.actor,
            candidateId,
          );
          if (params.has("download")) {
            const source = await (dependencies.fetchMedia ?? fetch)(item.url, { cache: "no-store" });
            if (!source.ok || !source.body) throw new Error("media download failed");
            return new NextResponse(source.body, {
              headers: {
                "Cache-Control": "private, no-store",
                "Content-Disposition": `attachment; filename*=UTF-8''${attachmentFileName(item.fileName)}`,
                "Content-Type": source.headers.get("Content-Type") ?? item.mimeType,
              },
            });
          }
          const response = params.has("open") ? NextResponse.redirect(item.url, 307) : mobileOk(item);
          response.headers.set("Cache-Control", "private, no-store");
          return response;
        }
        const response = mobileOk(await (dependencies.list ?? getMediaLibrarySnapshot)(
          authenticated.actor,
          parseMediaLibraryQuery(params),
        ));
        response.headers.set("Cache-Control", "private, no-store");
        return response;
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
        const body = await readJson(request);
        if (body && typeof body === "object" && "action" in body && body.action === "extract-metadata") {
          if (!("id" in body) || typeof body.id !== "string") return mobileError("errors.invalidData", 400);
          const response = mobileOk(await (dependencies.extractMetadata ?? extractMediaLibraryMetadata)(authenticated.actor, body.id));
          response.headers.set("Cache-Control", "private, no-store");
          return response;
        }
        if (body && typeof body === "object" && "action" in body && body.action === "delete-many") {
          if (!("ids" in body) || !Array.isArray(body.ids) || body.ids.length < 1 ||
              body.ids.length > 20 || !body.ids.every(isMobileEntityId) ||
              new Set(body.ids).size !== body.ids.length) {
            return mobileError("errors.invalidData", 400);
          }
          const result = await (dependencies.removeMany ?? deleteMediaLibraryItems)(
            authenticated.actor,
            body.ids,
          );
          return mobileOk(result);
        }
        const item = await (dependencies.create ?? createMediaLibraryItem)(
          authenticated.actor,
          body,
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
