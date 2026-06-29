"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssistantActionPreset, AssistantActionPresetGroup } from "./types";

const SECONDARY_GROUPS: AssistantActionPresetGroup[] = ["sales", "inventory", "products", "partners", "reports"];

function actionPresetToneClass(tone: AssistantActionPreset["tone"], active: boolean) {
  if (active) {
    if (tone === "sale") return "border-primary-400 bg-primary-50 text-primary-700 shadow-[0_10px_24px_rgba(15,118,110,0.10)]";
    if (tone === "purchase") return "border-amber-400 bg-amber-50 text-amber-800 shadow-[0_10px_24px_rgba(217,119,6,0.10)]";
    return "border-emerald-400 bg-emerald-50 text-emerald-800 shadow-[0_10px_24px_rgba(5,150,105,0.10)]";
  }
  if (tone === "sale") return "border-border-soft bg-surface/90 text-slate-600 hover:border-primary-200 hover:bg-primary-50";
  if (tone === "purchase") return "border-border-soft bg-surface/90 text-slate-600 hover:border-amber-200 hover:bg-amber-50";
  return "border-border-soft bg-surface/90 text-slate-600 hover:border-emerald-200 hover:bg-emerald-50";
}

export function ActionPresetButtons({
  presets,
  activePreset,
  busy,
  onSelect,
  variant,
}: {
  presets: AssistantActionPreset[];
  activePreset: AssistantActionPreset | null;
  busy: boolean;
  onSelect: (preset: AssistantActionPreset) => void;
  variant: "grid" | "strip";
}) {
  const t = useTranslations();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const primaryPresets = presets.filter((preset) => preset.placement === "primary");
  const secondaryPresets = presets.filter((preset) => preset.placement === "secondary");
  const visiblePresets = secondaryPresets.length ? primaryPresets : presets;

  useEffect(() => {
    if (!open) return;
    function closeOnOutsideClick(event: PointerEvent) {
      const menu = menuRef.current;
      if (!menu || menu.contains(event.target as Node)) return;
      setOpen(false);
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  return (
    <div className={cn(
      variant === "grid" ? "grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-5" : "flex flex-wrap gap-1.5"
    )}>
      {visiblePresets.map((preset) => {
        const Icon = preset.icon;
        const active = activePreset?.id === preset.id;
        return (
          <Button
            key={preset.id}
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => onSelect(preset)}
            className={cn(
              "group h-auto min-w-0 border text-left transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
              actionPresetToneClass(preset.tone, active),
              variant === "grid"
                ? "justify-start rounded-2xl px-3 py-2.5"
                : "max-w-full rounded-full px-2.5 py-1.5"
            )}
            title={preset.description}
          >
            <span className={cn("flex min-w-0 items-center", variant === "grid" ? "gap-2.5" : "gap-1.5")}>
              <span className={cn(
                "grid shrink-0 place-items-center rounded-xl bg-white/75",
                variant === "grid" ? "h-7 w-7" : "h-5 w-5"
              )}>
                <Icon className={cn(variant === "grid" ? "h-3.5 w-3.5" : "h-3.5 w-3.5")} />
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate font-bold", variant === "grid" ? "text-[13px]" : "text-xs")}>{preset.label}</span>
                {variant === "grid" && <span className="mt-0.5 block truncate text-[11px] opacity-70">{preset.description}</span>}
              </span>
            </span>
          </Button>
        );
      })}
      {secondaryPresets.length > 0 && (
        <div ref={menuRef} className="relative min-w-0">
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => setOpen((value) => !value)}
            className={cn(
              "group h-auto min-w-0 border border-border-soft bg-surface/90 text-left text-slate-600 transition hover:-translate-y-0.5 hover:bg-surface-2 disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:translate-y-0",
              variant === "grid"
                ? "w-full justify-start rounded-2xl px-3 py-2.5"
                : "max-w-full rounded-full px-2.5 py-1.5"
            )}
            title={t("ai.actions.more")}
            aria-expanded={open}
          >
            <span className={cn("flex min-w-0 items-center", variant === "grid" ? "gap-2.5" : "gap-1.5")}>
              <span className={cn(
                "grid shrink-0 place-items-center rounded-xl bg-white/75",
                variant === "grid" ? "h-7 w-7" : "h-5 w-5"
              )}>
                <ChevronDown className={cn("h-3.5 w-3.5 transition", open && "rotate-180")} />
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate font-bold", variant === "grid" ? "text-[13px]" : "text-xs")}>{t("ai.actions.more")}</span>
                {variant === "grid" && <span className="mt-0.5 block truncate text-[11px] opacity-70">{t("ai.actions.moreDescription")}</span>}
              </span>
            </span>
          </Button>

          {open && (
            <div className={cn(
              "absolute bottom-full z-50 mb-2 max-h-[min(420px,52vh)] w-[min(92vw,560px)] overflow-y-auto rounded-xl border border-border bg-surface p-3 shadow-e2",
              "right-0"
            )}>
              <div className="grid gap-3 sm:grid-cols-2">
                {SECONDARY_GROUPS.map((group) => {
                  const groupPresets = secondaryPresets.filter((preset) => preset.group === group);
                  if (!groupPresets.length) return null;
                  return (
                    <div key={group} className="min-w-0">
                      <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wide text-slate-400">
                        {t(`ai.actionGroups.${group}`)}
                      </div>
                      <div className="grid gap-1.5">
                        {groupPresets.map((preset) => {
                          const Icon = preset.icon;
                          const active = activePreset?.id === preset.id;
                          return (
                            <Button
                              key={preset.id}
                              type="button"
                              variant="ghost"
                              disabled={busy}
                              onClick={() => {
                                setOpen(false);
                                onSelect(preset);
                              }}
                              className={cn(
                                "h-auto justify-start rounded-lg px-2.5 py-2 text-left",
                                active ? "bg-primary-50 text-primary-700" : "text-slate-600 hover:bg-surface-2 dark:text-slate-300"
                              )}
                              title={preset.description}
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <Icon className="h-4 w-4 shrink-0" />
                                <span className="min-w-0">
                                  <span className="block truncate text-xs font-bold">{preset.label}</span>
                                  <span className="block truncate text-[11px] opacity-70">{preset.description}</span>
                                </span>
                              </span>
                            </Button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
