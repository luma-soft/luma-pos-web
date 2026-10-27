import { formatStoreAddress, getVietnamProvince, getVietnamWard } from "@/lib/addresses/vietnam";

export type VietnamAddressInput = {
  address?: string | null;
  addressLine?: string | null;
  addressProvinceCode?: string | null;
  addressWardCode?: string | null;
};

export function hasValidVietnamAddressSelection(input: VietnamAddressInput) {
  const provinceCode = input.addressProvinceCode?.trim() ?? "";
  const wardCode = input.addressWardCode?.trim() ?? "";
  if (!provinceCode && !wardCode) return true;
  if (!provinceCode || !wardCode) return false;
  return Boolean(getVietnamProvince(provinceCode) && getVietnamWard(provinceCode, wardCode));
}

export function addressWriteFields(input: VietnamAddressInput) {
  const hasStructuredFields = input.addressLine !== undefined
    || input.addressProvinceCode !== undefined
    || input.addressWardCode !== undefined;
  if (!hasStructuredFields) {
    return { address: input.address?.trim() || null };
  }

  const addressLine = input.addressLine?.trim() ?? "";
  const addressProvinceCode = input.addressProvinceCode?.trim() ?? "";
  const addressWardCode = input.addressWardCode?.trim() ?? "";
  return {
    address: formatStoreAddress(addressLine, addressProvinceCode, addressWardCode) || addressLine || null,
    addressLine,
    addressProvinceCode,
    addressWardCode,
  };
}
