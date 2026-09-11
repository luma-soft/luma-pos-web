"use client";

import { Search } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Select } from "@/components/ui/select";
import { Routes } from "@/lib/routes";

export function RevenueBookFilters() {
  const router = useRouter();
  const searchParams = useSearchParams();

  function update(key: string, value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("page");
    if (value && value !== "all") params.set(key, value);
    else params.delete(key);
    router.push(`${Routes.Accounting}?${params.toString()}`);
  }

  return (
    <div className="grid gap-3 rounded-card border border-border bg-surface p-3 sm:grid-cols-[minmax(240px,1fr)_190px_210px]">
      <form className="relative" action={Routes.Accounting}>
        {Array.from(searchParams.entries()).filter(([key]) => key !== "q" && key !== "page").map(([key, value]) => (
          <input key={key} type="hidden" name={key} value={value} />
        ))}
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        <input
          name="q"
          defaultValue={searchParams.get("q") ?? ""}
          placeholder="Tìm mã giao dịch, khách hàng"
          aria-label="Tìm giao dịch trong sổ"
          className="h-11 w-full rounded-xl border border-border bg-surface pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
        />
      </form>
      <Select
        value={searchParams.get("document") ?? "all"}
        onValueChange={(value) => update("document", value)}
        aria-label="Loại giao dịch"
        options={[
          { value: "all", label: "Tất cả giao dịch" },
          { value: "sale", label: "Bán hàng" },
          { value: "return", label: "Trả hàng" },
        ]}
      />
      <Select
        value={searchParams.get("einvoice") ?? "all"}
        onValueChange={(value) => update("einvoice", value)}
        aria-label="Trạng thái hóa đơn điện tử"
        options={[
          { value: "all", label: "Tất cả HĐ điện tử" },
          { value: "issued", label: "Đã phát hành HĐĐT" },
          { value: "none", label: "Chưa có HĐĐT" },
        ]}
      />
    </div>
  );
}
