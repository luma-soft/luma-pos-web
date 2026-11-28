"use client";

import { useTranslations } from "next-intl";
import { cn, formatCurrency } from "@/lib/utils";
import type { EditExcessChoice } from "@/lib/pos/edit-settlement";

type Props = {
  alreadyPaid: number;
  due: number;
  excess: number;
  excessChoice: EditExcessChoice;
  hasCustomer: boolean;
  onExcessChoice: (choice: EditExcessChoice) => void;
  variant?: "desktop" | "mobile";
};

/**
 * Editing a paid invoice: what was already collected, what is still due, and
 * (when the new total is lower) whether the excess goes back to the customer
 * or stays as credit. Shared by the desktop panel and the mobile sheet.
 */
export function EditSettlementSummary({
  alreadyPaid, due, excess, excessChoice, hasCustomer, onExcessChoice, variant = "desktop",
}: Props) {
  const t = useTranslations("pos.invoiceEdit");
  const mobile = variant === "mobile";
  const row = cn("flex items-center justify-between gap-2", mobile ? "text-[15px]" : "text-sm");
  return (
    <div className={cn("space-y-2", mobile ? "" : "rounded-lg border border-border bg-surface-2 px-3 py-2")}>
      <div className={row}>
        <span className="text-slate-500">{t("alreadyPaid")}</span>
        <span className="font-semibold tabular-nums">{formatCurrency(alreadyPaid)}</span>
      </div>
      {excess > 0 ? (
        <>
          <div className={row}>
            <span className="text-slate-500">{t("excess")}</span>
            <span className="font-semibold tabular-nums text-ok">{formatCurrency(excess)}</span>
          </div>
          {hasCustomer ? (
            <div role="radiogroup" aria-label={t("excess")} className="grid grid-cols-2 gap-1.5">
              {(["credit", "refund"] as const).map((choice) => (
                <button
                  key={choice}
                  type="button"
                  role="radio"
                  aria-checked={excessChoice === choice}
                  onClick={() => onExcessChoice(choice)}
                  className={cn(
                    "rounded-lg border font-medium",
                    mobile ? "min-h-11 text-[15px]" : "py-1.5 text-xs",
                    excessChoice === choice
                      ? "border-primary-600 bg-primary-600 text-white"
                      : "border-border text-slate-600 dark:text-slate-300",
                  )}
                >
                  {t(choice === "credit" ? "excessCredit" : "excessRefund")}
                </button>
              ))}
            </div>
          ) : null}
          <p className="text-xs text-slate-500">
            {t(!hasCustomer ? "excessWalkInHint" : excessChoice === "credit" ? "excessCreditHint" : "excessRefundHint", {
              amount: formatCurrency(excess),
            })}
          </p>
        </>
      ) : (
        <div className={row}>
          <span className="text-slate-500">{t("collectMore")}</span>
          <span className="font-semibold tabular-nums">{formatCurrency(due)}</span>
        </div>
      )}
    </div>
  );
}
