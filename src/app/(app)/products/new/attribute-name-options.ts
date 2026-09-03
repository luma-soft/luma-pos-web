import type { ProductAttribute } from "@/lib/products/attribute-catalog";

export function buildAttributeNameOptions(catalog: ProductAttribute[], currentName?: string) {
  const options = catalog.map(
    ({ name }) => ({ value: name, label: name }),
  );
  if (
    currentName?.trim() &&
    !options.some((option) => option.value === currentName)
  ) {
    options.push({ value: currentName, label: currentName });
  }
  return options;
}
