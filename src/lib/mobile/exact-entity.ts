const uuidPattern = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

export function isMobileEntityId(value: string) {
  return uuidPattern.test(value);
}
