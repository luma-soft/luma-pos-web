"use client";

import { useTranslations } from "next-intl";
import { Maximize2, Minus, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { cn } from "@/lib/utils";
import type { AssistantSurface } from "./types";

export function AssistantHeader({
  surface,
  onMinimize,
  onClose,
}: {
  surface: AssistantSurface;
  onMinimize: () => void;
  onClose: () => void;
}) {
  const t = useTranslations();
  const isPos = surface === "pos";

  return (
    <div className="min-h-14 px-3.5 py-2.5 border-b border-border flex items-center justify-between gap-3 shrink-0">
      <div className="min-w-0 flex items-center gap-2.5">
        <div className="w-9 h-9 rounded-xl bg-primary-50 dark:bg-primary-950/50 border border-primary-200 dark:border-primary-900 text-primary-700 dark:text-primary-300 grid place-items-center shrink-0">
          <Sparkles className="w-4 h-4" />
        </div>
        <div className="min-w-0">
          <div className="text-sm font-bold truncate">{isPos ? t("ai.posTitle") : t("ai.launcherTitle")}</div>
          <div className="text-[10.5px] font-semibold text-primary-600 truncate">{t("ai.launcherStatus")}</div>
        </div>
      </div>
      <div className="flex items-center gap-1">
        {!isPos && (
          <a
            href="/ai?tab=assistant"
            className={cn(buttonVariants({ variant: "outline", size: "iconSm" }), "hidden sm:grid text-slate-500 hover:bg-surface-2")}
            title={t("ai.openWorkspace")}
            aria-label={t("ai.openWorkspace")}
          >
            <Maximize2 className="w-4 h-4" />
          </a>
        )}
        <Button
          type="button"
          variant="outline"
          size="iconSm"
          onClick={onMinimize}
          className="text-slate-500 hover:bg-surface-2"
          title={t("ai.minimize")}
          aria-label={t("ai.minimize")}
        >
          <Minus className="w-4 h-4" />
        </Button>
        <Button
          type="button"
          variant="outline"
          size="iconSm"
          onClick={onClose}
          className="text-slate-500 hover:bg-surface-2"
          title={t("common.close")}
          aria-label={t("common.close")}
        >
          <X className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
}
