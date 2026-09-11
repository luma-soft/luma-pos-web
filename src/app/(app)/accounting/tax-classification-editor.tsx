"use client";

import { useMemo, useState, useTransition } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { updateProductTaxActivities } from "@/lib/actions/accounting";

type Product = { id: string; sku: string; name: string; taxActivityId: string | null };
type Activity = { id: string; name: string; vatRate: number; pitRate: number };

export function TaxClassificationEditor({ products, activities }: { products: Product[]; activities: Activity[] }) {
  const [values, setValues] = useState(() => Object.fromEntries(products.map((item) => [item.id, item.taxActivityId ?? ""])));
  const [query, setQuery] = useState("");
  const [message, setMessage] = useState("");
  const [pending, startTransition] = useTransition();
  const visible = useMemo(() => products.filter((item) => `${item.name} ${item.sku}`.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi"))), [products, query]);
  function save() {
    setMessage("");
    startTransition(async () => {
      const changed = products.filter((item) => (values[item.id] || null) !== item.taxActivityId).map((item) => ({ productId: item.id, activityId: values[item.id] || null }));
      const result = await updateProductTaxActivities(changed);
      setMessage(result.ok ? `Đã lưu phân loại cho ${changed.length} sản phẩm.` : result.error);
    });
  }
  return (
    <section className="space-y-3">
      <div className="flex flex-col gap-3 rounded-card border border-border bg-surface p-3 sm:flex-row">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên hoặc SKU" className="h-11 min-w-0 flex-1 rounded-xl border border-border bg-surface px-3 text-sm outline-none focus:border-primary-500" />
        <Button onClick={save} disabled={pending}><Save className="h-4 w-4" />{pending ? "Đang lưu…" : "Lưu phân loại"}</Button>
      </div>
      {message && <div className="rounded-xl border border-border bg-surface px-4 py-3 text-sm font-medium">{message}</div>}
      <div className="overflow-hidden rounded-card border border-border bg-surface">
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(220px,360px)] gap-3 border-b border-border bg-surface-2 px-4 py-3 text-xs font-bold uppercase text-slate-500"><span>Sản phẩm</span><span>Nhóm ngành tính thuế</span></div>
        <div className="max-h-[62dvh] divide-y divide-border overflow-y-auto">
          {visible.map((item) => <div key={item.id} className="grid grid-cols-1 gap-2 px-4 py-3 sm:grid-cols-[minmax(0,1fr)_minmax(220px,360px)] sm:items-center"><div className="min-w-0"><div className="truncate text-sm font-bold">{item.name}</div><div className="text-xs text-slate-400">{item.sku}</div></div><Select value={values[item.id]} onValueChange={(value) => setValues((current) => ({ ...current, [item.id]: value }))} options={[{ value: "", label: "Chưa phân loại" }, ...activities.map((activity) => ({ value: activity.id, label: activity.name, description: `GTGT ${activity.vatRate}% · TNCN ${activity.pitRate}%` }))]} searchable /></div>)}
        </div>
      </div>
    </section>
  );
}
