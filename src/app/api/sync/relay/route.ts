import { createClient as createBearerClient } from "@supabase/supabase-js";
import { createClient as createCookieClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import {
  POS_ORDER_SYNC_COMMAND,
  SYNC_RELAY_MAX_BODY_BYTES,
  SYNC_RELAY_STATUS_LIMIT,
  syncRelaySubmitSchema,
} from "@/lib/sync/relay";

export const dynamic = "force-dynamic";

type RelayRole = "owner" | "manager" | "cashier";

async function authenticatedUser(request: Request) {
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

async function salesMembership(storeId: string, userId: string) {
  const supabase = createSupabaseAdminClient();
  const { data, error } = await supabase
    .from("sync_relay_memberships")
    .select("role, is_active")
    .eq("store_id", storeId)
    .eq("user_id", userId)
    .eq("is_active", true)
    .maybeSingle();
  if (error || !data?.is_active) return null;
  if (data.role !== "owner" && data.role !== "manager" && data.role !== "cashier") return null;
  return data.role as RelayRole;
}

function privateJson(body: unknown, status = 200) {
  const response = Response.json(body, { status });
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  return response;
}

function relayDisabledResponse() {
  return privateJson({ ok: false, error: "SYNC_RELAY_DISABLED" }, 503);
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
  if (process.env.LUMAPOS_SYNC_RELAY_ENABLED !== "true") return relayDisabledResponse();
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
  const role = await salesMembership(input.storeId, user.id);
  if (!role) return privateJson({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("sync_relay_events")
      .insert({
        event_id: input.eventId,
        store_id: input.storeId,
        user_id: user.id,
        device_id: input.deviceId,
        command_type: POS_ORDER_SYNC_COMMAND,
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

    console.error("Sync relay rejected a POS command", error?.code ?? "UNKNOWN");
    return privateJson({ ok: false, error: "SYNC_RELAY_UNAVAILABLE" }, 503);
  } catch {
    return privateJson({ ok: false, error: "SYNC_RELAY_UNAVAILABLE" }, 503);
  }
}

export async function GET(request: Request) {
  if (process.env.LUMAPOS_SYNC_RELAY_ENABLED !== "true") return relayDisabledResponse();
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

  const role = await salesMembership(storeId, user.id);
  if (!role) return privateJson({ ok: false, error: "FORBIDDEN" }, 403);

  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase
      .from("sync_relay_events")
      .select("position, event_id, store_id, status, result, error_code, processed_at")
      .eq("store_id", storeId)
      .eq("user_id", user.id)
      .eq("command_type", POS_ORDER_SYNC_COMMAND)
      .in("event_id", eventIds)
      .order("position", { ascending: true })
      .limit(SYNC_RELAY_STATUS_LIMIT);

    if (error) {
      console.error("Sync relay could not read POS events", error.code);
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
