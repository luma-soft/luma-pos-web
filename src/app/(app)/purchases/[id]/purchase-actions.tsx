"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, XCircle } from "lucide-react";
import { cancelPurchase } from "@/lib/actions/purchases";

export function PurchaseCancelButton({ purchaseId }: { purchaseId: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function onCancel() {
    if (busy || !confirm(t("purchases.cancelConfirm"))) return;
    setBusy(true);
    const res = await cancelPurchase(purchaseId);
    setBusy(false);
    if (res.ok) router.refresh();
    else alert(t(res.error as never));
  }

  return (
    <button
      type="button"
      onClick={onCancel}
      disabled={busy}
      className="inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-red-200 px-3 text-sm font-medium text-er hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/40"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
      {t("purchases.cancel")}
    </button>
  );
}
