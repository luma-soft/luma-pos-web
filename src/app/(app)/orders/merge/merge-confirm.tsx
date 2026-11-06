"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, GitMerge } from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { Routes } from "@/lib/routes";
import { mergeOrders } from "@/lib/actions/order-edit";

export function MergeConfirm({ ids, disabled }: { ids: string[]; disabled: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const confirmDialog = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState("");

  async function confirm() {
    if (disabled || busy || confirming) return;
    setConfirming(true);
    const accepted = await confirmDialog.confirm({
      title: t("merge.confirmTitle"),
      description: t("merge.confirmMessage", { count: ids.length }),
      confirmLabel: t("merge.confirm", { count: ids.length }),
      cancelLabel: t("common.cancel"),
      variant: "warning",
    });
    setConfirming(false);
    if (!accepted || disabled || busy) return;

    setBusy(true);
    setError("");
    const res = await mergeOrders(ids);
    setBusy(false);
    if (res.ok) router.push(Routes.salesOrder(res.data.id, "completed"));
    else setError(t(res.error as never));
  }

  return (
    <div className="flex flex-col items-end gap-2">
      {error && <p className="text-sm text-er">{error}</p>}
      <button
        onClick={confirm} disabled={disabled || busy || confirming}
        className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-5 py-2.5 text-sm font-medium text-white transition hover:bg-primary-700 disabled:opacity-50 sm:w-auto lg:min-h-0 lg:min-w-0"
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <GitMerge className="w-4 h-4" />}
        {t("merge.confirm", { count: ids.length })}
      </button>
    </div>
  );
}
