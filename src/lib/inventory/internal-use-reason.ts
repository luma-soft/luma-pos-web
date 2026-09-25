import { catalogText } from "../i18n/catalog-text";

const REASON_LABELS: Record<string, string> = {
  staff: "staff",
  mobile_product_internal_use: "mobile_product_internal_use",
  sample: "sample",
  consumable: "consumable",
  display: "display",
  gift: "gift",
  staff_meal: "staff_meal",
  supplies: "supplies",
  cleaning: "cleaning",
  training: "training",
  other: "other",
};

export function internalUseReasonLabel(
  value: string | null | undefined,
  locale: string,
): string {
  const source = value?.trim();
  if (!source) return "—";
  const labels = REASON_LABELS[source.toLowerCase()];
  if (!labels) return source;
  return catalogText(locale, `inventory.internalUse.reasons.${labels}`);
}
