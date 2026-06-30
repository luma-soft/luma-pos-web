"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2 } from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { Routes } from "@/lib/routes";
import { convertQuoteToOrder } from "@/lib/actions/orders";
import { cn } from "@/lib/utils";

export function QuoteCreateOrderButton({
  quoteId,
  className,
}: {
  quoteId: string;
  className?: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  async function convert() {
    if (busy) return;
    const ok = await dialog.confirm({
      description: t("quotes.convertConfirm"),
      confirmLabel: t("quotes.convert"),
    });
    if (!ok) return;
    setBusy(true);
    const res = await convertQuoteToOrder(quoteId);
    setBusy(false);
    if (res.ok) router.push(Routes.order(quoteId));
    else await dialog.alert({ description: t(res.error as never), variant: "destructive" });
  }

  return (
    <button
      type="button"
      onClick={convert}
      disabled={busy}
      className={cn(
        "inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50",
        className,
      )}
    >
      {busy && <Loader2 className="h-4 w-4 animate-spin" />}
      {t("quotes.convert")}
    </button>
  );
}
