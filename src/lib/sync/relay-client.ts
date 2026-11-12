import {
  SYNC_RELAY_STATUS_LIMIT,
  type SyncRelayReceipt,
  type SyncRelaySubmitInput,
} from "@/lib/sync/relay";

export async function stableSyncEventId(localId: string): Promise<string> {
  const bytes = new TextEncoder().encode(`lumapos-pos-order:${localId}`);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)).slice(0, 16);
  digest[6] = (digest[6] & 0x0f) | 0x80;
  digest[8] = (digest[8] & 0x3f) | 0x80;
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

type RelayEnvelope<T> = { ok: true; data: T } | { ok: false; error: string };

export class SyncRelayRequestError extends Error {
  constructor(readonly statusCode: number, code: string) {
    super(code);
  }
}

export type SyncRelaySubmission = {
  duplicate: boolean;
  position: string;
  eventId: string;
  status: SyncRelayReceipt["status"];
};

async function parseEnvelope<T>(response: Response): Promise<T> {
  let envelope: RelayEnvelope<T>;
  try {
    envelope = await response.json() as RelayEnvelope<T>;
  } catch {
    throw new SyncRelayRequestError(response.status, "SYNC_RELAY_INVALID_RESPONSE");
  }
  if (!response.ok || !envelope.ok) {
    throw new SyncRelayRequestError(
      response.status,
      !envelope.ok ? envelope.error : "SYNC_RELAY_UNAVAILABLE",
    );
  }
  return envelope.data;
}

export async function submitSyncRelayEvent(input: SyncRelaySubmitInput): Promise<SyncRelaySubmission> {
  const response = await fetch("/api/sync/relay", {
    method: "POST",
    headers: { "content-type": "application/json" },
    cache: "no-store",
    body: JSON.stringify(input),
  });
  return parseEnvelope<SyncRelaySubmission>(response);
}

export async function fetchSyncRelayReceipts(
  storeId: string,
  eventIds: readonly string[],
): Promise<SyncRelayReceipt[]> {
  const uniqueIds = [...new Set(eventIds)].filter(Boolean);
  const receipts: SyncRelayReceipt[] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += SYNC_RELAY_STATUS_LIMIT) {
    const params = new URLSearchParams({
      storeId,
      eventIds: uniqueIds.slice(offset, offset + SYNC_RELAY_STATUS_LIMIT).join(","),
    });
    const response = await fetch(`/api/sync/relay?${params.toString()}`, {
      method: "GET",
      cache: "no-store",
    });
    const data = await parseEnvelope<{ receipts: SyncRelayReceipt[] }>(response);
    receipts.push(...data.receipts);
  }
  return receipts;
}
