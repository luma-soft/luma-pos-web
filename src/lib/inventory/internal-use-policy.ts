export function canCreateInternalUse(role: string) {
  return role === "owner" || role === "manager" || role === "warehouse";
}
