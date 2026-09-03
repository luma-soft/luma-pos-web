import { z } from "zod";

export type ProductAttribute = {
  id: string;
  name: string;
  aliases: string[];
  productCount: number;
};

export const attributeNameSchema = z.string()
  .transform((name) => name.trim().replace(/\s+/g, " "))
  .pipe(z.string().min(1).max(100).refine((name) => !name.startsWith("__")));

export function attributeNameKey(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findCatalogAttribute(catalog: ProductAttribute[], name: string) {
  const key = attributeNameKey(name);
  return catalog.find((attribute) => attribute.aliases.includes(key));
}
