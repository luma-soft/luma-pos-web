"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, X } from "lucide-react";
import { createTrip, markStopDelivered, startTrip } from "@/lib/actions/delivery";

export function TripCreate({ orders }: { orders: { id: string; label: string }[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [vehicle, setVehicle] = useState("");
  const [driver, setDriver] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!vehicle.trim() || !driver.trim() || selected.length === 0 || busy) return;
    setBusy(true);
    setError("");
    const res = await createTrip({ vehicle, driver, orderIds: selected });
    setBusy(false);
    if (res.ok) {
      setOpen(false); setVehicle(""); setDriver(""); setSelected([]);
      router.refresh();
    } else setError(t(res.error as never));
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">
        <Plus className="w-4 h-4" />
        {t("delivery.createTrip")}
      </button>
    );
  }

  const cls = "px-3 py-2 text-sm rounded-lg border border-border bg-surface";
  return (
    <div className="bg-surface border border-border rounded-card p-4 w-full max-w-xl space-y-3">
      <div className="flex justify-between items-center">
        <b className="text-sm">{t("delivery.createTrip")}</b>
        <button onClick={() => setOpen(false)} className="p-1 text-slate-400"><X className="w-4 h-4" /></button>
      </div>
      <div className="flex gap-2">
        <input value={vehicle} onChange={(e) => setVehicle(e.target.value)} placeholder={`${t("delivery.vehicle")} *`} className={`${cls} flex-1`} />
        <input value={driver} onChange={(e) => setDriver(e.target.value)} placeholder={`${t("delivery.driver")} *`} className={`${cls} flex-1`} />
      </div>
      <div className="max-h-52 overflow-auto border border-slate-200 dark:border-slate-700 rounded-lg divide-y divide-border-soft">
        {orders.length === 0 && <p className="p-4 text-sm text-slate-400">{t("delivery.noOrders")}</p>}
        {orders.map((o) => (
          <label key={o.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-surface-2">
            <input
              type="checkbox"
              checked={selected.includes(o.id)}
              onChange={(e) => setSelected((s) => e.target.checked ? [...s, o.id] : s.filter((x) => x !== o.id))}
            />
            <span className="truncate">{o.label}</span>
          </label>
        ))}
      </div>
      {error && <p className="text-xs text-er">{error}</p>}
      <button onClick={submit} disabled={busy || !vehicle.trim() || !driver.trim() || selected.length === 0}
        className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("delivery.createTripBtn", { count: selected.length })}
      </button>
    </div>
  );
}

export function TripStart({ tripId }: { tripId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => { setBusy(true); const r = await startTrip(tripId); setBusy(false); if (r.ok) router.refresh(); }}
      disabled={busy}
      className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium disabled:opacity-50"
    >
      {t("delivery.start")}
    </button>
  );
}

export function StopActions({ stopId }: { stopId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      onClick={async () => { setBusy(true); const r = await markStopDelivered(stopId); setBusy(false); if (r.ok) router.refresh(); }}
      disabled={busy}
      className="px-3 py-1.5 rounded-lg border border-emerald-300 dark:border-emerald-800 text-ok text-xs font-medium disabled:opacity-50 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 whitespace-nowrap"
    >
      ✓ {t("delivery.markDelivered")}
    </button>
  );
}
