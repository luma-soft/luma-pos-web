import { PRESET_ATTRIBUTES } from "./schema";

export function buildAttributeNameOptions(currentName?: string) {
  const options: Array<{ value: string; label: string }> = PRESET_ATTRIBUTES.map(
    (name) => ({ value: name, label: name }),
  );
  if (
    currentName?.trim() &&
    !options.some((option) => option.value === currentName)
  ) {
    options.push({ value: currentName, label: currentName });
  }
  return options;
}
