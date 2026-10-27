import catalog from "./vietnam-admin.json";

export type VietnamAddressOption = {
  code: string;
  name: string;
  englishName: string;
  latitude: number;
  longitude: number;
};

type VietnamAddressCatalog = {
  provinces: VietnamAddressOption[];
  wards: Array<VietnamAddressOption & { provinceCode: string }>;
};

const data = catalog as VietnamAddressCatalog;

export const vietnamProvinces = [...data.provinces].sort((a, b) => a.name.localeCompare(b.name, "vi"));

export function getVietnamProvince(code: string | null | undefined) {
  if (!code) return undefined;
  return vietnamProvinces.find((province) => province.code === code);
}

export function getVietnamWards(provinceCode: string | null | undefined) {
  if (!provinceCode) return [];
  return data.wards
    .filter((ward) => ward.provinceCode === provinceCode)
    .sort((a, b) => a.name.localeCompare(b.name, "vi"));
}

export function getVietnamWard(provinceCode: string | null | undefined, wardCode: string | null | undefined) {
  if (!provinceCode || !wardCode) return undefined;
  return data.wards.find((ward) => ward.provinceCode === provinceCode && ward.code === wardCode);
}

export function formatStoreAddress(
  addressLine: string | null | undefined,
  provinceCode: string | null | undefined,
  wardCode: string | null | undefined,
) {
  const line = addressLine?.trim() ?? "";
  const province = getVietnamProvince(provinceCode);
  const ward = getVietnamWard(provinceCode, wardCode);
  return [line, ward?.name, province?.name].filter((part): part is string => Boolean(part)).join(", ");
}

function normalizeAdministrativeName(value: string) {
  const withoutTypePrefix = value
    .trim()
    .toLocaleLowerCase("vi-VN")
    .replace(/^(?:thành phố|thanh pho|thị trấn|thi tran|phường|phuong|xã|xa|tỉnh|tinh)\s+/u, "")
    .replace(/^(?:tp\.?|p\.?|x\.?)\s*/u, "");
  return withoutTypePrefix
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/[^a-z0-9]/g, "");
}

export function findVietnamProvinceByName(value: string) {
  const normalized = normalizeAdministrativeName(value);
  return vietnamProvinces.find((province) => normalizeAdministrativeName(province.name) === normalized);
}

export function findVietnamWardByName(provinceCode: string, value: string) {
  const normalized = normalizeAdministrativeName(value);
  return getVietnamWards(provinceCode).find((ward) => normalizeAdministrativeName(ward.name) === normalized);
}

/**
 * Recover structured fields from the old "detail, ward, province" format.
 * Only exact final ward/province matches are accepted; arbitrary text is kept
 * intact as the manually entered address line.
 */
export function parseLegacyStoreAddress(address: string | null | undefined) {
  const rawAddress = address?.trim() ?? "";
  const separators = [/[,;\n]/, /[,;\n]|\s+[–—-]\s+/];
  for (const separator of separators) {
    const parts = rawAddress.split(separator).map((part) => part.trim()).filter(Boolean);
    while (parts.length && ["Vietnam", "Viet Nam", "Việt Nam"].includes(parts.at(-1)!)) parts.pop();
    if (parts.length < 2) continue;

    const province = findVietnamProvinceByName(parts.at(-1)!);
    const ward = province ? findVietnamWardByName(province.code, parts.at(-2)!) : undefined;
    if (province && ward) {
      return {
        addressLine: parts.slice(0, -2).join(", "),
        addressProvinceCode: province.code,
        addressWardCode: ward.code,
      };
    }
  }

  return { addressLine: rawAddress, addressProvinceCode: "", addressWardCode: "" };
}

export function resolveStoreAddress(address: {
  addressLine?: string | null;
  addressProvinceCode?: string | null;
  addressWardCode?: string | null;
  address?: string | null;
}) {
  const province = getVietnamProvince(address.addressProvinceCode);
  const ward = getVietnamWard(address.addressProvinceCode, address.addressWardCode);
  if (province && ward) {
    const line = address.addressLine?.trim() ?? "";
    return {
      addressLine: line,
      addressProvinceCode: province.code,
      addressWardCode: ward.code,
      addressProvinceName: province.name,
      addressWardName: ward.name,
      addressLatitude: ward.latitude,
      addressLongitude: ward.longitude,
      address: formatStoreAddress(line, province.code, ward.code),
    };
  }

  const legacy = parseLegacyStoreAddress(address.address);
  const parsedProvince = getVietnamProvince(legacy.addressProvinceCode);
  const parsedWard = getVietnamWard(legacy.addressProvinceCode, legacy.addressWardCode);
  if (parsedProvince && parsedWard) {
    return {
      addressLine: legacy.addressLine,
      addressProvinceCode: parsedProvince.code,
      addressWardCode: parsedWard.code,
      addressProvinceName: parsedProvince.name,
      addressWardName: parsedWard.name,
      addressLatitude: parsedWard.latitude,
      addressLongitude: parsedWard.longitude,
      address: formatStoreAddress(legacy.addressLine, parsedProvince.code, parsedWard.code),
    };
  }

  const line = address.addressLine?.trim() || address.address?.trim() || "";
  return {
    addressLine: line,
    addressProvinceCode: "",
    addressWardCode: "",
    addressProvinceName: "",
    addressWardName: "",
    addressLatitude: null,
    addressLongitude: null,
    address: line,
  };
}
