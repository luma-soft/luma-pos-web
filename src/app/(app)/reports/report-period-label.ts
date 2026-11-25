/** "dd/MM/yyyy – dd/MM/yyyy" (or one date) for a custom report range given as yyyy-MM-dd values. */
export function formatReportRange(from: string, to: string) {
  const format = (value: string) => value.split("-").reverse().join("/");
  return from === to ? format(from) : `${format(from)} – ${format(to)}`;
}
