"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { Routes } from "@/lib/routes";
import { cancelQuote, convertQuoteToOrder } from "@/lib/actions/orders";
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
    if (res.ok) router.push(Routes.salesOrder(quoteId, "completed"));
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

export function BookingCreateOrderButton({
  bookingId,
  className,
}: {
  bookingId: string;
  className?: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  async function convert() {
    if (busy) return;
    const ok = await dialog.confirm({
      description: t("bookings.convertConfirm"),
      confirmLabel: t("bookings.convert"),
    });
    if (!ok) return;
    setBusy(true);
    const res = await convertQuoteToOrder(bookingId);
    setBusy(false);
    if (res.ok) router.push(Routes.salesOrder(bookingId, "completed"));
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
      {t("bookings.convert")}
    </button>
  );
}

export function QuoteDeleteButton({
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

  async function remove() {
    if (busy) return;
    const ok = await dialog.confirm({
      description: t("quotes.cancelConfirm"),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    });
    if (!ok) return;
    setBusy(true);
    const res = await cancelQuote(quoteId);
    setBusy(false);
    if (res.ok) router.refresh();
    else await dialog.alert({ description: t(res.error as never), variant: "destructive" });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-red-200 px-3 py-2 text-sm font-medium text-er hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/40",
        className,
      )}
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      {t("common.delete")}
    </button>
  );
}
