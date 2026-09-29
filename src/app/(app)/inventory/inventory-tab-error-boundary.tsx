"use client";

import { unstable_catchError as catchError, type ErrorInfo } from "next/error";
import { useTransition } from "react";
import { useTranslations } from "next-intl";
import { RotateCw, ServerCrash } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

function InventoryTabErrorFallback(
  { tabTitle }: { tabTitle: string },
  { error, unstable_retry }: ErrorInfo,
) {
  const t = useTranslations();
  const [retrying, startTransition] = useTransition();
  const digest = (error as Error & { digest?: string }).digest;

  return (
    <div role="alert" className="rounded-card border border-red-200 bg-surface p-5 dark:border-red-900/60 sm:p-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
        <div className="grid size-10 shrink-0 place-items-center rounded-xl bg-red-50 text-red-500 dark:bg-red-950/40">
          <ServerCrash className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <Text as="h2" weight="semibold" className="tracking-tight" text={t("appError.title")} />
          <Text as="p" variant="muted" className="mt-1 leading-relaxed" text={t("appError.tabDescription", { tab: tabTitle })} />
        </div>
        <Button
          type="button"
          onClick={() => startTransition(() => unstable_retry())}
          disabled={retrying}
          className="shrink-0"
        >
          <RotateCw className={`size-4 ${retrying ? "animate-spin" : ""}`} />
          {retrying ? t("appError.retrying") : t("appError.retry")}
        </Button>
      </div>
      {digest && (
        <Text as="p" variant="muted" className="mt-4 text-[11px] font-mono select-all" text={t("appError.digest", { digest })} />
      )}
    </div>
  );
}

export const InventoryTabErrorBoundary = catchError(InventoryTabErrorFallback);
