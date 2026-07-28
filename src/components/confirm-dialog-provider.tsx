"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { AlertTriangle, Info, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type ConfirmVariant = "default" | "destructive" | "warning";

type DialogOptions = {
  title?: string;
  description: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: ConfirmVariant;
};

type DialogState = DialogOptions & {
  mode: "confirm" | "alert";
};

type ConfirmDialogContextValue = {
  confirm: (options: DialogOptions | string) => Promise<boolean>;
  alert: (options: Omit<DialogOptions, "cancelLabel"> | string) => Promise<void>;
};

const ConfirmDialogContext = createContext<ConfirmDialogContextValue | null>(null);

function normalizeOptions(options: DialogOptions | string): DialogOptions {
  return typeof options === "string" ? { description: options } : options;
}

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const t = useTranslations();
  const [state, setState] = useState<DialogState | null>(null);
  const resolveRef = useRef<((confirmed: boolean) => void) | null>(null);

  const close = useCallback((confirmed: boolean) => {
    resolveRef.current?.(confirmed);
    resolveRef.current = null;
    setState(null);
  }, []);

  const open = useCallback((mode: DialogState["mode"], options: DialogOptions) => {
    resolveRef.current?.(false);

    return new Promise<boolean>((resolve) => {
      resolveRef.current = resolve;
      setState({ mode, ...options });
    });
  }, []);

  const confirm = useCallback<ConfirmDialogContextValue["confirm"]>(
    (options) => open("confirm", normalizeOptions(options)),
    [open],
  );

  const alert = useCallback<ConfirmDialogContextValue["alert"]>(
    async (options) => {
      await open("alert", normalizeOptions(options));
    },
    [open],
  );

  useEffect(() => {
    if (!state) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close(false);
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, state]);

  const variant = state?.variant ?? "default";
  const destructive = variant === "destructive";
  const warning = variant === "warning";
  const Icon = destructive || warning ? AlertTriangle : Info;

  return (
    <ConfirmDialogContext.Provider value={{ confirm, alert }}>
      {children}
      {state && (
        <div
          className="fixed inset-0 z-[120] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]"
          onMouseDown={() => close(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="app-confirm-title"
            aria-describedby="app-confirm-desc"
            className="w-full max-w-md overflow-hidden rounded-card border border-border bg-surface shadow-2xl"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3 border-b border-border-soft px-4 py-4">
              <div
                className={cn(
                  "mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg",
                  destructive && "bg-red-50 text-er dark:bg-red-950/40",
                  warning && "bg-amber-50 text-warn dark:bg-amber-950/40",
                  !destructive && !warning && "bg-primary-50 text-primary-600 dark:bg-primary-950/40",
                )}
              >
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <h2 id="app-confirm-title" className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  {state.title ?? t(state.mode === "alert" ? "common.error" : "common.confirm")}
                </h2>
                <p id="app-confirm-desc" className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-600 dark:text-slate-300">
                  {state.description}
                </p>
              </div>
              <button
                type="button"
                onClick={() => close(false)}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-slate-700 dark:hover:text-slate-200 lg:h-8 lg:w-8"
                aria-label={t("common.close")}
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="flex flex-wrap justify-end gap-2 px-4 py-3">
              {state.mode === "confirm" && (
                <Button type="button" variant="outline" size="sm" onClick={() => close(false)}>
                  {state.cancelLabel ?? t("common.cancel")}
                </Button>
              )}
              <Button
                type="button"
                variant={destructive ? "destructive" : "default"}
                size="sm"
                onClick={() => close(true)}
              >
                {state.confirmLabel ?? t(state.mode === "alert" ? "common.close" : "common.confirm")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmDialogContext.Provider>
  );
}

export function useConfirmDialog() {
  const context = useContext(ConfirmDialogContext);
  if (!context) throw new Error("useConfirmDialog must be used inside ConfirmDialogProvider");
  return context;
}
