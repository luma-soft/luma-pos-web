const REASON_LABELS: Record<string, readonly [en: string, vi: string]> = {
  staff: ["Staff use", "Nhân viên sử dụng"],
  mobile_product_internal_use: ["Staff use", "Nhân viên sử dụng"],
  sample: ["Samples & marketing", "Hàng mẫu / tiếp thị"],
  consumable: ["Store consumables", "Vật tư tiêu hao"],
  display: ["Display", "Trưng bày"],
  gift: ["Gift / Promo", "Quà tặng / KM"],
  staff_meal: ["Staff meals", "Bữa ăn nhân viên"],
  supplies: ["Office supplies", "Vật tư văn phòng"],
  cleaning: ["Cleaning supplies", "Vật tư vệ sinh"],
  training: ["Staff training", "Đào tạo nhân viên"],
  other: ["Other", "Khác"],
};

export function internalUseReasonLabel(
  value: string | null | undefined,
  locale: string,
): string {
  const source = value?.trim();
  if (!source) return "—";
  const labels = REASON_LABELS[source.toLowerCase()];
  if (!labels) return source;
  return locale === "vi" ? labels[1] : labels[0];
}
