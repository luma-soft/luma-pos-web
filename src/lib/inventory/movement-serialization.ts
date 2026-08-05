export function serializeMovementCreatedAt(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new TypeError("Invalid stock movement createdAt value");
  }
  return date.toISOString();
}
