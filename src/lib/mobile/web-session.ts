import { Routes } from "@/lib/routes";

export const MOBILE_WEB_SESSION_TARGETS = [
  "/camera-price-list",
  Routes.HunonicPriceList,
  Routes.RangDongSmartPriceList,
] as const;

export type MobileWebSessionTarget =
  (typeof MOBILE_WEB_SESSION_TARGETS)[number];

export function resolveMobileWebSessionTarget(
  value: string | null | undefined,
): MobileWebSessionTarget | null {
  if (!value) return null;
  return (MOBILE_WEB_SESSION_TARGETS as readonly string[]).includes(value)
    ? (value as MobileWebSessionTarget)
    : null;
}

export function readBearerToken(request: Request): string | null {
  const header = request.headers.get("authorization")?.trim() ?? "";
  const match = /^Bearer\s+(\S+)$/i.exec(header);
  return match?.[1] ?? null;
}

export function readRefreshToken(request: Request): string | null {
  const token = request.headers.get("x-luma-refresh-token")?.trim() ?? "";
  return token || null;
}
