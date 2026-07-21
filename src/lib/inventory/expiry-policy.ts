export type ExpiryLotInput = {
  id: string;
  expiryDate: string | null;
  availableQuantity: string | number;
  requiresExpiry: boolean;
  [key: string]: unknown;
};

export type ExpiryAlertStatus = "expired" | "expiring" | "missing_expiry";

function addCalendarDays(isoDate: string, days: number) {
  const date = new Date(`${isoDate}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function summarizeExpiryLots<T extends ExpiryLotInput>(
  lots: T[],
  options: { today: string; warningDays?: number },
) {
  const warningDays = Math.max(1, Math.min(365, options.warningDays ?? 30));
  const warningThrough = addCalendarDays(options.today, warningDays);
  const rows: Array<T & { status: ExpiryAlertStatus; daysRemaining: number | null }> = [];

  for (const lot of lots) {
    if (Number(lot.availableQuantity) <= 0) continue;
    let status: ExpiryAlertStatus | null = null;
    let daysRemaining: number | null = null;
    if (lot.expiryDate) {
      daysRemaining = Math.round(
        (Date.parse(`${lot.expiryDate}T00:00:00.000Z`) -
          Date.parse(`${options.today}T00:00:00.000Z`)) /
          86_400_000,
      );
      if (lot.expiryDate < options.today) status = "expired";
      else if (lot.expiryDate <= warningThrough) status = "expiring";
    } else if (lot.requiresExpiry) {
      status = "missing_expiry";
    }
    if (status) rows.push({ ...lot, status, daysRemaining });
  }

  const expiredCount = rows.filter((row) => row.status === "expired").length;
  const expiringCount = rows.filter((row) => row.status === "expiring").length;
  const missingExpiryCount = rows.filter((row) => row.status === "missing_expiry").length;
  return {
    attentionCount: rows.length,
    expiredCount,
    expiringCount,
    missingExpiryCount,
    warningDays,
    rows,
  };
}
