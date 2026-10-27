"use client";

import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { SearchableSelect } from "@/components/combobox";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type AddressOption = { code: string; name: string; englishName: string };
type Option = { value: string; label: string };

export type VietnamAddressValue = {
  addressLine: string;
  addressProvinceCode: string;
  addressWardCode: string;
};

export function VietnamAddressFields({
  value,
  onChange,
  disabled = false,
  error,
  className,
  idPrefix = "address",
}: {
  value: VietnamAddressValue;
  onChange: (next: VietnamAddressValue) => void;
  disabled?: boolean;
  error?: string;
  className?: string;
  idPrefix?: string;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const [provinces, setProvinces] = useState<Option[]>([]);
  const [wards, setWards] = useState<Option[]>([]);
  const [loadingProvinces, setLoadingProvinces] = useState(false);
  const [loadingWards, setLoadingWards] = useState(false);
  const labelClassName = "mb-1 block text-xs font-medium text-slate-500";
  const inputClassName = "min-h-11 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm";

  useEffect(() => {
    let cancelled = false;
    setLoadingProvinces(true);
    fetch("/api/public/address-catalog", { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("address_catalog_unavailable");
        return response.json() as Promise<{ data?: { options?: AddressOption[] } }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setProvinces((payload.data?.options ?? []).map((option) => ({
          value: option.code,
          label: locale === "vi" ? option.name : option.englishName,
        })));
      })
      .catch(() => { if (!cancelled) setProvinces([]); })
      .finally(() => { if (!cancelled) setLoadingProvinces(false); });
    return () => { cancelled = true; };
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    if (!value.addressProvinceCode) {
      setWards([]);
      setLoadingWards(false);
      return () => { cancelled = true; };
    }
    setLoadingWards(true);
    fetch(`/api/public/address-catalog?provinceCode=${encodeURIComponent(value.addressProvinceCode)}`, { cache: "force-cache" })
      .then(async (response) => {
        if (!response.ok) throw new Error("address_catalog_unavailable");
        return response.json() as Promise<{ data?: { options?: AddressOption[] } }>;
      })
      .then((payload) => {
        if (cancelled) return;
        setWards((payload.data?.options ?? []).map((option) => ({
          value: option.code,
          label: locale === "vi" ? option.name : option.englishName,
        })));
      })
      .catch(() => { if (!cancelled) setWards([]); })
      .finally(() => { if (!cancelled) setLoadingWards(false); });
    return () => { cancelled = true; };
  }, [locale, value.addressProvinceCode]);

  return (
    <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2", className)}>
      <div>
        <label className={labelClassName} htmlFor={`${idPrefix}-province`}>
          {t("settings.storeAddress.province")}
        </label>
        <SearchableSelect
          id={`${idPrefix}-province`}
          ariaLabel={t("settings.storeAddress.province")}
          options={provinces}
          value={value.addressProvinceCode}
          onChange={(addressProvinceCode) => onChange({ ...value, addressProvinceCode, addressWardCode: "" })}
          placeholder={loadingProvinces ? t("settings.storeAddress.loadingProvinces") : t("settings.storeAddress.chooseProvince")}
          allowClear
          disabled={disabled || loadingProvinces}
          className="w-full"
        />
      </div>
      <div>
        <label className={labelClassName} htmlFor={`${idPrefix}-ward`}>
          {t("settings.storeAddress.ward")}
        </label>
        <SearchableSelect
          id={`${idPrefix}-ward`}
          ariaLabel={t("settings.storeAddress.ward")}
          options={wards}
          value={value.addressWardCode}
          onChange={(addressWardCode) => onChange({ ...value, addressWardCode })}
          placeholder={loadingWards
            ? t("settings.storeAddress.loadingWards")
            : t(value.addressProvinceCode ? "settings.storeAddress.chooseWard" : "settings.storeAddress.chooseProvinceFirst")}
          allowClear
          disabled={disabled || !value.addressProvinceCode || loadingWards}
          className="w-full"
        />
        {error && <span className="mt-1 block text-xs text-er" role="alert">{error}</span>}
      </div>
      <div className="sm:col-span-2">
        <label className={labelClassName} htmlFor={`${idPrefix}-line`}>
          {t("settings.storeAddress.addressLine")}
        </label>
        <Input
          id={`${idPrefix}-line`}
          className={inputClassName}
          value={value.addressLine}
          disabled={disabled}
          placeholder={t("settings.storeAddress.addressLinePlaceholder")}
          onChange={(event) => onChange({ ...value, addressLine: event.target.value })}
        />
      </div>
    </div>
  );
}
