import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const ORDER_STYLES: Record<string, string> = {
  completed: "bg-ok-soft text-ok",
  cancelled: "bg-er-soft text-er",
  draft: "bg-surface-2 text-slate-600",
  quote: "bg-in-soft text-in",
  confirmed: "bg-in-soft text-in",
  delivering: "bg-in-soft text-in",
  returned: "bg-warn-soft text-warn",
};

const PAYMENT_STYLES: Record<string, string> = {
  paid: "bg-ok-soft text-ok",
  unpaid: "bg-er-soft text-er",
  deposit: "bg-warn-soft text-warn",
  partial: "bg-warn-soft text-warn",
  refunded: "bg-surface-2 text-slate-600",
};

export function OrderStatusBadge({ status }: { status: string }) {
  const t = useTranslations();
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", ORDER_STYLES[status] ?? ORDER_STYLES.draft)}>
      {t(`orders.status.${status}`)}
    </span>
  );
}

export function PaymentStatusBadge({ status }: { status: string }) {
  const t = useTranslations();
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", PAYMENT_STYLES[status] ?? PAYMENT_STYLES.unpaid)}>
      {t(`orders.paymentStatus.${status}`)}
    </span>
  );
}
