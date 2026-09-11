export function upsertPosCartLine<T>(
  lines: readonly T[],
  matches: (line: T) => boolean,
  create: () => T,
  increment: (line: T) => T,
): T[] {
  const existingIndex = lines.findIndex(matches);
  if (existingIndex < 0) return [create(), ...lines];
  const updated = increment(lines[existingIndex]);
  return [updated, ...lines.slice(0, existingIndex), ...lines.slice(existingIndex + 1)];
}
