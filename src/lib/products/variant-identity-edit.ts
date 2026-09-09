import {
  normalizeVariantAttributes,
  variantNameKey,
  VariantValidationError,
  type NormalizedVariantAttribute,
} from "./variant-model";

export type VariantValueEdit = {
  attributeId: string;
  optionValueId: string;
  value: string;
};

/** Rename persisted option labels without changing the IDs that identify SKUs. */
export function applyVariantValueEdits(
  attributes: readonly NormalizedVariantAttribute[],
  edits: readonly VariantValueEdit[],
): NormalizedVariantAttribute[] {
  const normalized = normalizeVariantAttributes(attributes);
  if (edits.length !== normalized.length) {
    throw new VariantValidationError("products.variants.invalidValues");
  }
  const editByAttribute = new Map(edits.map((edit) => [edit.attributeId, edit]));
  if (editByAttribute.size !== edits.length) {
    throw new VariantValidationError("products.variants.invalidValues");
  }
  return normalized.map((attribute) => {
    const edit = editByAttribute.get(attribute.attributeId);
    const index = edit ? attribute.valueIds.indexOf(edit.optionValueId) : -1;
    const value = edit?.value.trim().replace(/\s+/g, " ") ?? "";
    if (index < 0 || !value || attribute.values.some((existing, valueIndex) =>
      valueIndex !== index && variantNameKey(existing) === variantNameKey(value))) {
      throw new VariantValidationError("products.variants.invalidValues");
    }
    return {
      ...attribute,
      values: attribute.values.map((existing, valueIndex) => valueIndex === index ? value : existing),
    };
  });
}
