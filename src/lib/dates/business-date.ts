export const BUSINESS_TIME_ZONE = "Asia/Ho_Chi_Minh";

const businessDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function businessDateKey(now = new Date()): string {
  return businessDateFormatter.format(now);
}

export function calendarDayDistance(target: string, today: string): number {
  const targetTime = Date.parse(`${target}T00:00:00Z`);
  const todayTime = Date.parse(`${today}T00:00:00Z`);
  if (!Number.isFinite(targetTime) || !Number.isFinite(todayTime)) {
    throw new RangeError("Expected ISO calendar dates");
  }
  return Math.round((targetTime - todayTime) / 86_400_000);
}
