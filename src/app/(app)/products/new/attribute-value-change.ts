import type { CreateProductInput } from "./schema";

type Attribute = NonNullable<CreateProductInput["attributes"]>[number];

/** Renaming a selected SKU value must not enable group generation. */
export function attributeValueChange(attribute: Attribute, values: string[], valueIds: string[], locked: boolean): Attribute {
  return { ...attribute, values, valueIds, createsVariants: locked ? attribute.createsVariants : true };
}
