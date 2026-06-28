"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { HelpCircle, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";

export function AiHelpButton() {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const guideItems = [
    t("ai.help.itemAsk"),
    t("ai.help.itemAction"),
    t("ai.help.itemAttach"),
    t("ai.help.itemAudit"),
  ];

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="iconSm"
        onClick={() => setOpen(true)}
        className="h-7 w-7 rounded-full text-slate-500 hover:bg-surface-2"
        title={t("ai.help.open")}
        aria-label={t("ai.help.open")}
      >
        <HelpCircle className="h-4 w-4" />
      </Button>

      {open && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="ai-help-title"
            className="w-full max-w-lg overflow-hidden rounded-card border border-border bg-surface shadow-e2"
          >
            <header className="flex items-start justify-between gap-3 border-b border-border px-5 py-4">
              <div className="flex min-w-0 items-start gap-3">
                <div className="grid h-9 w-9 shrink-0 place-items-center rounded-xl border border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900 dark:bg-primary-950/50 dark:text-primary-300">
                  <Sparkles className="h-4 w-4" />
                </div>
                <div className="min-w-0">
                  <h2 id="ai-help-title" className="text-base font-bold text-slate-900 dark:text-slate-100">
                    {t("ai.help.title")}
                  </h2>
                  <p className="mt-1 text-xs font-medium leading-5 text-slate-500">
                    {t("ai.help.subtitle")}
                  </p>
                </div>
              </div>
              <Button
                type="button"
                variant="outline"
                size="iconSm"
                onClick={() => setOpen(false)}
                className="shrink-0 text-slate-500 hover:bg-surface-2"
                title={t("common.close")}
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </Button>
            </header>

            <div className="space-y-4 px-5 py-4">
              <div className="rounded-xl border border-in/20 bg-in-soft px-3.5 py-3 text-xs font-semibold leading-5 text-in">
                {t("ai.actionNotice")}
              </div>
              <ul className="space-y-2">
                {guideItems.map((item) => (
                  <li key={item} className="flex gap-2 text-sm leading-6 text-slate-600 dark:text-slate-300">
                    <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary-500" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            <footer className="flex justify-end border-t border-border px-5 py-3">
              <Button type="button" size="sm" onClick={() => setOpen(false)}>
                {t("common.done")}
              </Button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}
