"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { createPromotion, togglePromotion } from "@/lib/actions/extras";
import { useProductCatalog } from "@/components/product-catalog-provider";

type Tier = { minQty: number; discountPct: number };

export function PromoQuickCreate() {
  const t = useTranslations();
  const router = useRouter();
  const { products } = useProductCatalog();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [productId, setProductId] = useState("");
  const [tiers, setTiers] = useState<Tier[]>([{ minQty: 50, discountPct: 3 }]);
  const [endsAt, setEndsAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const product = products.find((p) => p.id === productId);

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open]);

  function resetForm() {
    setName("");
    setProductId("");
    setTiers([{ minQty: 50, discountPct: 3 }]);
    setEndsAt("");
    setError("");
  }

  function closeModal() {
    if (busy) return;
    setOpen(false);
    resetForm();
  }

  async function submit() {
    if (!name.trim() || !productId || tiers.length === 0 || busy) return;
    setBusy(true);
    setError("");
    const res = await createPromotion({
      name, productId,
      tiers: tiers.filter((tr) => tr.minQty > 0 && tr.discountPct > 0),
      endsAt: endsAt || undefined,
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      resetForm();
      router.refresh();
    } else setError(t(res.error as never));
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} tx="promos.createNew">
        <Plus className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) closeModal();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="promo-create-title"
        className="flex max-h-[92dvh] w-full flex-col overflow-hidden rounded-t-2xl border border-border bg-surface shadow-2xl sm:max-w-2xl sm:rounded-card"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-4">
          <div>
            <Text id="promo-create-title" as="h2" weight="bold" className="text-base" text={t("promos.createNew")} />
            <Text as="p" variant="muted" size="xs" className="mt-1" text={t("promos.emptyHint")} />
          </div>
          <Button type="button" variant="ghost" size="iconSm" onClick={closeModal} disabled={busy} aria-label={t("common.close")}><X className="w-4 h-4" /></Button>
        </div>
        <div className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
          <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t("promos.cols.name")} *`} />
            <Input type="date" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} title={t("promos.endsAt")} />
          </div>
          <Select
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            options={[
              { value: "", label: t("purchases.pickProduct") },
              ...products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` })),
            ]}
            className="w-full sm:w-80"
          />
          <div className="space-y-2">
            {tiers.map((tier, i) => (
              <div key={i} className="grid grid-cols-[auto_minmax(72px,96px)_1fr_minmax(64px,88px)_auto_auto] items-center gap-2 text-sm">
                <Text as="span" variant="muted" text="≥" />
                <Input type="number" min={1} value={tier.minQty}
                  onChange={(e) => setTiers((ts) => ts.map((x, j) => j === i ? { ...x, minQty: Number(e.target.value) } : x))}
                  className="text-right" />
                <Text as="span" variant="muted" className="truncate" text={`${product?.baseUnit ?? t("purchases.unitLabel")} → ${t("promos.discount")}`} />
                <Input type="number" min={0} max={100} step={0.5} value={tier.discountPct}
                  onChange={(e) => setTiers((ts) => ts.map((x, j) => j === i ? { ...x, discountPct: Number(e.target.value) } : x))}
                  className="text-right" />
                <Text as="span" variant="muted" text="%" />
                {tiers.length > 1 ? (
                  <Button type="button" variant="ghost" size="iconSm" onClick={() => setTiers((ts) => ts.filter((_, j) => j !== i))} className="text-slate-400 hover:text-red-500" aria-label={t("common.delete")}>
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                ) : <span className="h-8 w-8" />}
              </div>
            ))}
            <Button
              type="button"
              variant="link"
              size="sm"
              onClick={() => setTiers((ts) => [...ts, { minQty: (ts[ts.length - 1]?.minQty ?? 0) * 2 || 100, discountPct: (ts[ts.length - 1]?.discountPct ?? 0) + 2 }])}
              className="h-auto px-0 text-xs"
              text={`+ ${t("promos.addTier")}`}
            />
          </div>
          {error && <Text as="p" variant="destructive" size="xs" text={error} />}
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-border-soft px-4 py-3">
          <Button type="button" variant="outline" onClick={closeModal} disabled={busy} tx="common.cancel" />
          <Button type="button" onClick={submit} disabled={busy || !name.trim() || !productId} loading={busy} tx="common.save" />
        </div>
      </div>
    </div>
  );
}

export function PromoToggle({ id, isActive }: { id: string; isActive: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await togglePromotion(id);
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <Button type="button" variant="link" size="sm" onClick={toggle} disabled={busy} className="h-auto px-0 text-xs" text={isActive ? t("promos.pause") : t("promos.resume")} />
  );
}
