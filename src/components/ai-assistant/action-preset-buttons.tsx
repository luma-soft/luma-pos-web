"use client";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { AssistantActionPreset } from "./types";

function actionPresetToneClass(tone: AssistantActionPreset["tone"], active: boolean) {
  if (active) {
    if (tone === "sale") return "border-primary-500 bg-primary-50 text-primary-700";
    if (tone === "purchase") return "border-amber-500 bg-amber-50 text-amber-800";
    return "border-emerald-500 bg-emerald-50 text-emerald-800";
  }
  if (tone === "sale") return "border-border bg-surface text-slate-600 hover:border-primary-200 hover:bg-primary-50";
  if (tone === "purchase") return "border-border bg-surface text-slate-600 hover:border-amber-200 hover:bg-amber-50";
  return "border-border bg-surface text-slate-600 hover:border-emerald-200 hover:bg-emerald-50";
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
  return (
    <div className={cn(
      variant === "grid" ? "mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" : "flex gap-1.5 overflow-x-auto"
    )}>
      {presets.map((preset) => {
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
              "group h-auto min-w-0 border text-left transition disabled:cursor-not-allowed disabled:opacity-50",
              actionPresetToneClass(preset.tone, active),
              variant === "grid"
                ? "justify-start rounded-xl px-3 py-3"
                : "shrink-0 rounded-full px-2.5 py-1.5"
            )}
            title={preset.description}
          >
            <span className={cn("flex min-w-0 items-center", variant === "grid" ? "gap-2.5" : "gap-1.5")}>
              <span className={cn(
                "grid shrink-0 place-items-center rounded-lg bg-white/70",
                variant === "grid" ? "h-8 w-8" : "h-5 w-5"
              )}>
                <Icon className={cn(variant === "grid" ? "h-4 w-4" : "h-3.5 w-3.5")} />
              </span>
              <span className="min-w-0">
                <span className={cn("block truncate font-bold", variant === "grid" ? "text-sm" : "text-xs")}>{preset.label}</span>
                {variant === "grid" && <span className="mt-0.5 block truncate text-xs opacity-70">{preset.description}</span>}
              </span>
            </span>
          </Button>
        );
      })}
    </div>
  );
}
