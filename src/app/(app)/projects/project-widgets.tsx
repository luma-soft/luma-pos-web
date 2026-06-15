"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Plus, X } from "lucide-react";
import { createProject, toggleProjectStatus } from "@/lib/actions/extras";

export function ProjectQuickCreate({ customers }: { customers: { id: string; name: string }[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await createProject({ name, customerId: customerId || null, address: address || undefined });
    setBusy(false);
    if (res.ok) {
      setOpen(false); setName(""); setAddress("");
      router.refresh();
    } else setError(t(res.error as never));
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium">
        <Plus className="w-4 h-4" />
        {t("projects.createNew")}
      </button>
    );
  }

  const cls = "px-3 py-2 text-sm rounded-lg border border-border bg-surface";
  return (
    <div className="flex items-end gap-2 bg-surface border border-border rounded-card p-3 flex-wrap">
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t("projects.cols.name")} *`} className={`${cls} w-52`} />
      <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} className={cls}>
        <option value="">{t("projects.noCustomer")}</option>
        {customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
      </select>
      <input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("customers.fields.address")} className={`${cls} w-52`} />
      <button onClick={submit} disabled={busy || !name.trim()} className="px-4 py-2 rounded-lg bg-primary-600 text-white text-sm font-medium disabled:opacity-50 inline-flex items-center gap-2">
        {busy && <Loader2 className="w-4 h-4 animate-spin" />}
        {t("common.save")}
      </button>
      <button onClick={() => setOpen(false)} className="p-2 text-slate-400"><X className="w-4 h-4" /></button>
      {error && <p className="text-xs text-er w-full">{error}</p>}
    </div>
  );
}

export function ProjectToggle({ id, status }: { id: string; status: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await toggleProjectStatus(id);
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <button onClick={toggle} disabled={busy} className="text-xs font-medium text-primary-600 hover:underline disabled:opacity-50">
      {status === "active" ? t("projects.markDone") : t("projects.reopen")}
    </button>
  );
}
