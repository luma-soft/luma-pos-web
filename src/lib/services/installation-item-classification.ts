export function inferServiceItemTracking(input: {
  name: string;
  categoryName?: string | null;
  baseUnit: string;
}): "consumable" | "asset" {
  const searchable = `${input.name} ${input.categoryName ?? ""}`.toLocaleLowerCase("vi");
  const consumableUnit = /^(m|mét|met|kg|g|l|ml|cuộn|cuon|bộ dây)$/i.test(input.baseUnit.trim());
  const consumableName = /dây|cáp|cap |ống|ong |nẹp|nep |keo|vít|vit |tắc kê|tac ke|vật tư|vat tu/.test(searchable);
  return consumableUnit || consumableName ? "consumable" : "asset";
}
