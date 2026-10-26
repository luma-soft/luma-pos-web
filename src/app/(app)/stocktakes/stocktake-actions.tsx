"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { balanceStocktake, cancelStocktake } from "@/lib/actions/stocktakes";
import { cn } from "@/lib/utils";

export function StocktakeRowActions({ id, status, canCancelBalanced = false, prominentCancel = false }: { id: string; status: string; canCancelBalanced?: boolean; prominentCancel?: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [busy, setBusy] = useState<"balance" | "cancel" | null>(null);

  const canCancel = status === "draft" || (status === "balanced" && canCancelBalanced);
  if (!canCancel) return null;

  async function balance() {
    if (busy) return;
    const ok = await dialog.confirm({
      description: t("stocktakes.balanceConfirm"),
      confirmLabel: t("stocktakes.balance"),
      variant: "warning",
    });
    if (!ok) return;
    setBusy("balance");
    const res = await balanceStocktake(id);
    setBusy(null);
    if (res.ok) router.refresh();
    else await dialog.alert({ description: t(res.error as never), variant: "destructive" });
  }

  async function cancel() {
    if (busy) return;
    const ok = await dialog.confirm({
      description: t(status === "balanced" ? "stocktakes.cancelBalancedConfirm" : "stocktakes.cancelConfirm"),
      confirmLabel: t("common.confirm"),
      variant: "destructive",
    });
    if (!ok) return;
    setBusy("cancel");
    const res = await cancelStocktake(id);
    setBusy(null);
    if (res.ok) router.refresh();
    else await dialog.alert({ description: t(res.error as never), variant: "destructive" });
  }

  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap">
      <button
        type="button"
        onClick={cancel}
        disabled={!!busy}
        className={cn(
          "inline-flex min-h-11 min-w-11 items-center gap-1 rounded-lg text-xs font-medium disabled:opacity-50",
          prominentCancel
            ? "border border-er/25 bg-er-soft/55 px-3 text-er hover:border-er/40 dark:bg-er/10"
            : "px-2 text-red-500 hover:bg-er-soft",
        )}
      >
        {busy === "cancel" && <Loader2 className="h-3 w-3 animate-spin" />}
        {t("common.cancel")}
      </button>
      {status === "draft" && (
        <button
          type="button"
          onClick={balance} disabled={!!busy}
          className="inline-flex min-h-11 items-center gap-1 rounded-lg bg-emerald-600 px-2.5 text-white text-xs font-medium disabled:opacity-50 min-w-11"
        >
          {busy === "balance" && <Loader2 className="w-3 h-3 animate-spin" />}
          {t("stocktakes.balance")}
        </button>
      )}
    </span>
  );
}
