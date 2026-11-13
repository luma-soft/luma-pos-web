import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { syncEvents } from "@/db/schema";
import { authProvider } from "@/lib/auth/provider";
import { getAuthenticatedUser, resolveStoreContextForUser } from "@/lib/auth/store-context";
import { createClient as createBearerClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { getSyncRelayConfig } from "@/lib/sync/config";
import {
  POS_ORDER_SYNC_COMMAND,
  SERVICE_FIELD_MUTATION_SYNC_COMMAND,
  SYNC_RELAY_MAX_BODY_BYTES,
  SYNC_RELAY_STATUS_LIMIT,
  syncRelaySubmitSchema,
} from "@/lib/sync/relay";

export const dynamic = "force-dynamic";

type RelayRole = "owner" | "manager" | "cashier" | "warehouse" | "technician";

async function authenticatedUser(request: Request) {
  if (authProvider() === "lumapos") return getAuthenticatedUser();

  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1]?.trim();
  if (bearer) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) return null;
    const supabase = createBearerClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.auth.getUser(bearer);
    return error ? null : data.user;
  }

  const supabase = await createCookieClient();
  const { data, error } = await supabase.auth.getUser();
  return error ? null : data.user;
}

async function relayMembership(storeId: string, userId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("sync_relay_memberships")
    .select("role, is_active")
    .eq("store_id", storeId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data?.is_active) return null;
  if (!(["owner", "manager", "cashier", "warehouse", "technician"] as string[]).includes(data.role)) return null;
  return data.role as RelayRole;
}

function canSubmitCommand(role: RelayRole, commandType: string) {
  if (commandType === POS_ORDER_SYNC_COMMAND) {
    return role === "owner" || role === "manager" || role === "cashier";
  }
  if (commandType === SERVICE_FIELD_MUTATION_SYNC_COMMAND) {
    return role === "owner" || role === "manager" || role === "technician";
  }
  return false;
}

function privateJson(body: unknown, status = 200) {
  const response = Response.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function relayDisabledResponse() {
  return privateJson({ ok: false, error: "SYNC_RELAY_DISABLED" }, 503);
}

function canonicalPayloadHash(commandType: string, payload: unknown, baseRevision?: string | number) {
  return createHash("sha256")
    .update(stableJson({
      commandType,
      payload,
      baseRevision: baseRevision == null ? null : String(baseRevision),
    }))
    .digest("hex");
}

class RelayRequestBodyError extends Error {
  constructor(readonly code: "PAYLOAD_TOO_LARGE" | "INVALID_JSON") {
    super(code);
  }
}

async function readJsonWithinLimit(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > SYNC_RELAY_MAX_BODY_BYTES) {
    throw new RelayRequestBodyError("PAYLOAD_TOO_LARGE");
  }

  const reader = request.body?.getReader();
  if (!reader) throw new RelayRequestBodyError("INVALID_JSON");
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      byteLength += value.byteLength;
      if (byteLength > SYNC_RELAY_MAX_BODY_BYTES) {
        await reader.cancel();
        throw new RelayRequestBodyError("PAYLOAD_TOO_LARGE");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof RelayRequestBodyError) throw error;
    throw new RelayRequestBodyError("INVALID_JSON");
  }

  const bytes = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new RelayRequestBodyError("INVALID_JSON");
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

export async function POST(request: Request) {
  const syncRelayConfig = getSyncRelayConfig();
  const provider = syncRelayConfig.provider;
  if (!syncRelayConfig.enabled) return relayDisabledResponse();
  const user = await authenticatedUser(request);
  if (!user) return privateJson({ ok: false, error: "UNAUTHORIZED" }, 401);

  let raw: unknown;
  try {
    raw = await readJsonWithinLimit(request);
  } catch (error) {
    const code = error instanceof RelayRequestBodyError ? error.code : "INVALID_JSON";
    return privateJson({ ok: false, error: code }, code === "PAYLOAD_TOO_LARGE" ? 413 : 400);
  }
  const parsed = syncRelaySubmitSchema.safeParse(raw);
  if (!parsed.success) return privateJson({ ok: false, error: "INVALID_SYNC_EVENT" }, 400);

  const input = parsed.data;
  const commandType = input.commandType ?? POS_ORDER_SYNC_COMMAND;
  if (commandType === SERVICE_FIELD_MUTATION_SYNC_COMMAND && !syncRelayConfig.serviceFieldEnabled) {
    return privateJson({ ok: false, error: "SYNC_COMMAND_DISABLED" }, 503);
  }

  if (authProvider() === "lumapos") {
    const context = await resolveStoreContextForUser(user.id);
    if (!context || context.storeId !== input.storeId
      || !canSubmitCommand(context.role, commandType)) {
      return privateJson({ ok: false, error: "FORBIDDEN" }, 403);
    }

    const payloadHash = canonicalPayloadHash(commandType, input.payload, input.baseRevision);
    try {
      return await db.transaction(async (tx) => {
        const [created] = await tx.insert(syncEvents).values({
          storeId: input.storeId,
          eventId: input.eventId,
          userId: user.id,
          deviceId: input.deviceId,
          commandType,
          baseRevision: input.baseRevision == null ? null : BigInt(input.baseRevision),
          payload: input.payload as Record<string, unknown>,
          payloadHash,
          status: "pending",
        }).onConflictDoNothing({
          target: [syncEvents.storeId, syncEvents.eventId],
        }).returning({
          position: syncEvents.position,
          eventId: syncEvents.eventId,
          status: syncEvents.status,
        });

        if (created) {
          return privateJson({
            ok: true,
            data: {
              duplicate: false,
              position: created.position.toString(),
              eventId: created.eventId,
              status: created.status,
            },
          }, 202);
        }

        const [existing] = await tx.select({
          position: syncEvents.position,
          eventId: syncEvents.eventId,
          userId: syncEvents.userId,
          deviceId: syncEvents.deviceId,
          commandType: syncEvents.commandType,
          payloadHash: syncEvents.payloadHash,
          status: syncEvents.status,
        }).from(syncEvents).where(and(
          eq(syncEvents.storeId, input.storeId),
          eq(syncEvents.eventId, input.eventId),
        )).limit(1).for("update");

        if (!existing || existing.userId !== user.id) {
          return privateJson({ ok: false, error: "SYNC_EVENT_ID_CONFLICT" }, 409);
        }
        if (existing.payloadHash !== payloadHash
          || existing.deviceId !== input.deviceId
          || existing.commandType !== commandType) {
          return privateJson({ ok: false, error: "SYNC_EVENT_ID_REUSED" }, 409);
        }

        return privateJson({
          ok: true,
          data: {
            duplicate: true,
            position: existing.position.toString(),
            eventId: existing.eventId,
            status: existing.status,
          },
        }, 202);
      });
    } catch {
      return privateJson({ ok: false, error: "SYNC_RELAY_UNAVAILABLE" }, 503);
    }
  }

  const role = await relayMembership(input.storeId, user.id);
  if (!role || !canSubmitCommand(role, commandType)) return privateJson({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("sync_relay_events")
      .insert({
        event_id: input.eventId,
        store_id: input.storeId,
        user_id: user.id,
        device_id: input.deviceId,
        command_type: commandType,
        base_revision: input.baseRevision == null ? null : String(input.baseRevision),
        payload: input.payload,
        status: "pending",
      })
      .select("position, event_id, status")
      .single();

    if (!error && data) {
      return privateJson({
        ok: true,
        data: {
          duplicate: false,
          position: String(data.position),
          eventId: data.event_id,
          status: data.status,
        },
      }, 202);
    }

    if (error?.code === "23505") {
      const existing = await supabase
        .from("sync_relay_events")
        .select("position, event_id, user_id, status, payload")
        .eq("store_id", input.storeId)
        .eq("event_id", input.eventId)
        .maybeSingle();
      if (existing.data?.user_id === user.id) {
        if (stableJson(existing.data.payload) !== stableJson(input.payload)) {
          return privateJson({ ok: false, error: "SYNC_EVENT_ID_REUSED" }, 409);
        }
        return privateJson({
          ok: true,
          data: {
            duplicate: true,
            position: String(existing.data.position),
            eventId: existing.data.event_id,
            status: existing.data.status,
          },
        }, 202);
      }
      return privateJson({ ok: false, error: "SYNC_EVENT_ID_CONFLICT" }, 409);
    }

    console.error("Sync relay rejected a command", error?.code ?? "UNKNOWN");
    return privateJson({ ok: false, error: "SYNC_RELAY_UNAVAILABLE" }, 503);
  } catch {
    return privateJson({ ok: false, error: "SYNC_RELAY_UNAVAILABLE" }, 503);
  }
}

export async function GET(request: Request) {
  const { provider, enabled } = getSyncRelayConfig();
  if (!enabled) return relayDisabledResponse();
  const user = await authenticatedUser(request);
  if (!user) return privateJson({ ok: false, error: "UNAUTHORIZED" }, 401);

  const params = new URL(request.url).searchParams;
  const storeId = params.get("storeId")?.trim() ?? "";
  const eventIds = [...new Set((params.get("eventIds") ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean))];
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(storeId)) {
    return privateJson({ ok: false, error: "INVALID_STORE_ID" }, 400);
  }
  if (eventIds.length < 1 || eventIds.length > SYNC_RELAY_STATUS_LIMIT
    || eventIds.some((eventId) => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(eventId))) {
    return privateJson({ ok: false, error: "INVALID_SYNC_EVENT_IDS" }, 400);
  }

  if (authProvider() === "lumapos") {
    const context = await resolveStoreContextForUser(user.id);
    if (!context || context.storeId !== storeId) {
      return privateJson({ ok: false, error: "FORBIDDEN" }, 403);
    }
    try {
      const rows = await db.select({
        position: syncEvents.position,
        eventId: syncEvents.eventId,
        storeId: syncEvents.storeId,
        status: syncEvents.status,
        result: syncEvents.result,
        errorCode: syncEvents.errorCode,
        processedAt: syncEvents.processedAt,
      }).from(syncEvents).where(and(
        eq(syncEvents.storeId, storeId),
        eq(syncEvents.userId, user.id),
        inArray(syncEvents.eventId, eventIds),
      )).orderBy(syncEvents.position).limit(SYNC_RELAY_STATUS_LIMIT);

      return privateJson({
        ok: true,
        data: {
          receipts: rows.map((event) => ({
            position: event.position.toString(),
            eventId: event.eventId,
            storeId: event.storeId,
            status: event.status,
            result: event.result,
            errorCode: event.errorCode,
            processedAt: event.processedAt?.toISOString() ?? null,
          })),
        },
      });
    } catch {
      return privateJson({ ok: false, error: "SYNC_RELAY_UNAVAILABLE" }, 503);
    }
  }

  const role = await relayMembership(storeId, user.id);
  if (!role) return privateJson({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("sync_relay_events")
      .select("position, event_id, store_id, status, result, error_code, processed_at")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .in("event_id", eventIds)
      .order("position", { ascending: true })
      .limit(SYNC_RELAY_STATUS_LIMIT);

    if (error) {
      console.error("Sync relay could not read events", error.code);
      return privateJson({ ok: false, error: "SYNC_RELAY_UNAVAILABLE" }, 503);
    }

    return privateJson({
      ok: true,
      data: {
        receipts: (data ?? []).map((event) => ({
          position: String(event.position),
          eventId: event.event_id,
          storeId: event.store_id,
          status: event.status,
          result: event.result,
          errorCode: event.error_code,
          processedAt: event.processed_at,
        })),
      },
    });
  } catch {
    return privateJson({ ok: false, error: "SYNC_RELAY_UNAVAILABLE" }, 503);
  }
}
