export function isWithinQuietHours(input: {
  now: Date;
  enabled: boolean;
  start: string;
  end: string;
  timezone: string;
}) {
  if (!input.enabled || input.start === input.end) return false;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: input.timezone,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(input.now);
  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? 0);
  const current = hour * 60 + minute;
  const toMinute = (value: string) => {
    const [h, m] = value.split(":").map(Number);
    return h * 60 + m;
  };
  const start = toMinute(input.start);
  const end = toMinute(input.end);
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}
