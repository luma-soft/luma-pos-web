export const DIRECT_TAX_REDUCTION_PERCENT = 20;

export const DIRECT_TAX_PRESETS = [
  {
    id: "direct-goods",
    labelKey: "directGoods",
    activityName: "Phân phối, cung cấp hàng hóa",
    vatRate: 1,
    pitRate: 0.5,
  },
  {
    id: "direct-production",
    labelKey: "directProduction",
    activityName: "Sản xuất, vận tải, dịch vụ gắn với hàng hóa, xây dựng có bao thầu vật liệu",
    vatRate: 3,
    pitRate: 1.5,
  },
  {
    id: "direct-services",
    labelKey: "directServices",
    activityName: "Dịch vụ, xây dựng không bao thầu vật liệu",
    vatRate: 5,
    pitRate: 2,
  },
  {
    id: "direct-other",
    labelKey: "directOther",
    activityName: "Hoạt động kinh doanh khác",
    vatRate: 2,
    pitRate: 1,
  },
  {
    id: "direct-kct-goods",
    labelKey: "directKctGoods",
    activityName: "Phân phối, cung cấp hàng hóa không chịu thuế GTGT",
    vatRate: 0,
    pitRate: 0.5,
  },
  {
    id: "direct-kct-production",
    labelKey: "directKctProduction",
    activityName: "Sản xuất, vận tải, dịch vụ gắn với hàng hóa không chịu thuế GTGT",
    vatRate: 0,
    pitRate: 1.5,
  },
  {
    id: "direct-kct-services",
    labelKey: "directKctServices",
    activityName: "Dịch vụ, xây dựng không bao thầu vật liệu không chịu thuế GTGT",
    vatRate: 0,
    pitRate: 2,
  },
] as const;

export type DirectTaxPreset = (typeof DIRECT_TAX_PRESETS)[number];

export function applyDirectTaxPreset<T extends { id: string; name: string; vatRate: number; pitRate: number; enabled: boolean }>(
  activities: T[],
  preset: DirectTaxPreset,
) {
  const activity = {
    id: preset.id,
    name: preset.activityName,
    vatRate: preset.vatRate,
    pitRate: preset.pitRate,
    enabled: true,
  } as T;
  const found = activities.some((item) => item.id === preset.id);
  return found
    ? activities.map((item) => item.id === preset.id ? { ...item, ...activity } : item)
    : [...activities, activity];
}
