"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, GitMerge } from "lucide-react";
import { Routes } from "@/lib/routes";
import { mergeOrders } from "@/lib/actions/order-edit";

export function MergeConfirm({ ids, disabled }: { ids: string[]; disabled: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (disabled || busy) return;
    setBusy(true);
    setError("");
    const res = await mergeOrders(ids);
    setBusy(false);
    if (res.ok) router.push(Routes.order(res.data.id));
    else setError(t(res.error as never));
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error && <p className="text-sm text-er">{error}</p>}
      <button
        onClick={confirm} disabled={disabled || busy}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-lg bg-primary-600 hover:bg-primary-700 text-white text-sm font-medium disabled:opacity-50"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
        {t("merge.confirm", { count: ids.length })}
      </button>
    </div>
  );
}
