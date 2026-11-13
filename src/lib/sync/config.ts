import "server-only";

import { authProvider } from "@/lib/auth/provider";

export type SyncRelayConfig = {
  provider: ReturnType<typeof authProvider>;
  enabled: boolean;
  serviceFieldEnabled: boolean;
};

/** Resolve the same relay flags for server-rendered clients and API routes. */
export function getSyncRelayConfig(): SyncRelayConfig {
  const provider = authProvider();
  const enabled = provider === "lumapos"
    ? process.env.LUMAPOS_SYNC_INBOX_ENABLED === "true"
    : process.env.LUMAPOS_SYNC_RELAY_ENABLED === "true";
  const serviceFieldEnabled = enabled && (provider === "lumapos"
    ? process.env.LUMAPOS_SERVICE_FIELD_SYNC_ENABLED === "true"
    : process.env.LUMAPOS_SERVICE_FIELD_RELAY_ENABLED === "true");

  return { provider, enabled, serviceFieldEnabled };
}
