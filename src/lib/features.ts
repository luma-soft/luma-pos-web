/**
 * Marketplace sales are temporarily hidden while the integration is not live.
 * Set NEXT_PUBLIC_ENABLE_ONLINE_SALES=true to restore all related UI entry points.
 */
export const ONLINE_SALES_ENABLED =
  process.env.NEXT_PUBLIC_ENABLE_ONLINE_SALES === "true";
