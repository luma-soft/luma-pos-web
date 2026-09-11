export const DIRECT_TAX_REDUCTION_PERCENT = 20;

export const DIRECT_TAX_PRESETS = [
  {
    id: "direct-goods",
    vi: "GTGT 1%, TNCN 0,5% (Phân phối, cung cấp hàng hóa)",
    en: "VAT 1%, PIT 0.5% (Distribution and supply of goods)",
    activityName: "Phân phối, cung cấp hàng hóa",
    vatRate: 1,
    pitRate: 0.5,
  },
  {
    id: "direct-production",
    vi: "GTGT 3%, TNCN 1,5% (Sản xuất, vận tải, dịch vụ gắn với hàng hóa, xây dựng có bao thầu vật liệu)",
    en: "VAT 3%, PIT 1.5% (Production, transport, goods-related services, construction with materials)",
    activityName: "Sản xuất, vận tải, dịch vụ gắn với hàng hóa, xây dựng có bao thầu vật liệu",
    vatRate: 3,
    pitRate: 1.5,
  },
  {
    id: "direct-services",
    vi: "GTGT 5%, TNCN 2% (Dịch vụ, xây dựng không bao thầu vật liệu)",
    en: "VAT 5%, PIT 2% (Services and construction without materials)",
    activityName: "Dịch vụ, xây dựng không bao thầu vật liệu",
    vatRate: 5,
    pitRate: 2,
  },
  {
    id: "direct-other",
    vi: "GTGT 2%, TNCN 1% (Hoạt động kinh doanh khác)",
    en: "VAT 2%, PIT 1% (Other business activities)",
    activityName: "Hoạt động kinh doanh khác",
    vatRate: 2,
    pitRate: 1,
  },
  {
    id: "direct-kct-goods",
    vi: "KCT GTGT, TNCN 0,5% (Phân phối, cung cấp hàng hóa không chịu thuế GTGT)",
    en: "Not subject to VAT, PIT 0.5% (Distribution of VAT-exempt goods)",
    activityName: "Phân phối, cung cấp hàng hóa không chịu thuế GTGT",
    vatRate: 0,
    pitRate: 0.5,
  },
  {
    id: "direct-kct-production",
    vi: "KCT GTGT, TNCN 1,5% (Sản xuất, vận tải, dịch vụ gắn với hàng hóa không chịu thuế GTGT)",
    en: "Not subject to VAT, PIT 1.5% (Production, transport and VAT-exempt goods-related services)",
    activityName: "Sản xuất, vận tải, dịch vụ gắn với hàng hóa không chịu thuế GTGT",
    vatRate: 0,
    pitRate: 1.5,
  },
  {
    id: "direct-kct-services",
    vi: "KCT GTGT, TNCN 2% (Dịch vụ, xây dựng không bao thầu vật liệu không chịu thuế GTGT)",
    en: "Not subject to VAT, PIT 2% (VAT-exempt services and construction without materials)",
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
