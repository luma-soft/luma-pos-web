export function upsertPosCartLine<T>(
  lines: readonly T[],
  matches: (line: T) => boolean,
  create: () => T,
  increment: (line: T) => T,
): T[] {
  const existingIndex = lines.findIndex(matches);
  if (existingIndex < 0) return [create(), ...lines];
  return lines.map((line, index) => index === existingIndex ? increment(line) : line);
}
