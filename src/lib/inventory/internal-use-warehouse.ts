export type InternalUseWarehouse = {
  id: string;
  name: string;
  isDefault: boolean;
};

export function resolveAuthoritativeInternalUseWarehouse(
  warehouses: readonly InternalUseWarehouse[],
): InternalUseWarehouse | null {
  return [...warehouses].sort((left, right) => {
    if (left.isDefault !== right.isDefault) return left.isDefault ? -1 : 1;
    const byName = left.name.localeCompare(right.name);
    if (byName !== 0) return byName;
    return left.id.localeCompare(right.id);
  })[0] ?? null;
}
