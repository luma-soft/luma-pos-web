"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { balanceStocktake, cancelStocktake } from "@/lib/actions/stocktakes";

export function StocktakeRowActions({ id, status }: { id: string; status: string }) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  if (status !== "draft") return null;

  async function balance() {
    if (busy) return;
    const ok = await dialog.confirm({
      description: t("stocktakes.balanceConfirm"),
      confirmLabel: t("stocktakes.balance"),
      variant: "warning",
    });
    if (!ok) return;
    setBusy(true);
    const res = await balanceStocktake(id);
    setBusy(false);
    if (res.ok) router.refresh();
    else await dialog.alert({ description: t(res.error as never), variant: "destructive" });
  }

  async function cancel() {
    if (busy) return;
    const ok = await dialog.confirm({
      description: t("stocktakes.cancelConfirm"),
      confirmLabel: t("common.cancel"),
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    const res = await cancelStocktake(id);
    setBusy(false);
    if (res.ok) router.refresh();
    else await dialog.alert({ description: t(res.error as never), variant: "destructive" });
  }

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <button onClick={cancel} disabled={busy} className="inline-flex min-h-11 items-center rounded-lg px-2 text-xs font-medium text-red-500 hover:bg-er-soft disabled:opacity-50 min-w-11">
        {t("common.cancel")}
      </button>
      <button
        onClick={balance} disabled={busy}
        className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-white text-xs font-medium disabled:opacity-50 min-w-11"
      >
        {busy && <Loader2 className="w-3 h-3 animate-spin" />}
        {t("stocktakes.balance")}
      </button>
    </span>
  );
}
