"use client";

import { type PointerEvent, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { AssistantChatSurface } from "@/components/ai-assistant/assistant-chat-surface";
import { AssistantHeader } from "@/components/ai-assistant/assistant-header";
import { useAssistantState } from "@/components/ai-assistant/use-assistant-state";
import type { AssistantSurface, FabDrag, FabPosition } from "@/components/ai-assistant/types";
import {
  FAB_MOVE_THRESHOLD,
  clampFabPosition,
  readFabPosition,
  saveFabPosition,
} from "@/components/ai-assistant/utils";

export function AssistantWorkspace() {
  const t = useTranslations();
  const assistant = useAssistantState("web");

  return (
    <div className="flex min-h-0 w-full flex-1 flex-col overflow-hidden">
      <AssistantChatSurface
        assistant={assistant}
        mode="workspace"
        emptyText={t("ai.assistantEmpty")}
        placeholder={t("ai.askPlaceholder")}
      />
    </div>
  );
}

export function AiAssistantLauncher({ surface = "web" }: { surface?: AssistantSurface }) {
  const t = useTranslations();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const fabSize = 56;
  const storageKey = `luma-ai-fab-position:${surface}`;
  const [fabPosition, setFabPosition] = useState<FabPosition | null>(() => readFabPosition(storageKey, fabSize));
  const dragRef = useRef<FabDrag | null>(null);
  const suppressClickRef = useRef(false);
  const assistant = useAssistantState(surface);
  const isPos = surface === "pos";

  if (surface === "web" && pathname?.startsWith("/ai")) {
    return null;
  }

  function openAssistant() {
    setOpen(true);
    setMinimized(false);
  }

  function startDrag(event: PointerEvent<HTMLButtonElement>) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.getBoundingClientRect();
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: rect.left,
      originY: rect.top,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;
    if (!drag.moved && Math.hypot(dx, dy) < FAB_MOVE_THRESHOLD) return;
    drag.moved = true;
    setFabPosition(clampFabPosition({ x: drag.originX + dx, y: drag.originY + dy }, fabSize));
  }

  function endDrag(event: PointerEvent<HTMLButtonElement>) {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag.moved) {
      openAssistant();
      return;
    }
    suppressClickRef.current = true;
    window.setTimeout(() => {
      suppressClickRef.current = false;
    }, 0);
    const rect = event.currentTarget.getBoundingClientRect();
    saveFabPosition(storageKey, clampFabPosition({ x: rect.left, y: rect.top }, fabSize));
  }

  function cancelDrag() {
    dragRef.current = null;
  }

  if (open && !minimized) {
    return (
      <>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="lg:hidden fixed inset-0 z-[54] bg-slate-950/30"
          aria-label={t("common.close")}
        />
        <section
          aria-label={t("ai.launcherTitle")}
          className={cn(
            "fixed z-[55] bg-surface border border-border shadow-e2 overflow-hidden flex flex-col",
            "inset-x-2 bottom-2 h-[min(85dvh,680px)] rounded-t-2xl rounded-b-card",
            "lg:inset-auto lg:top-4 lg:right-4 lg:bottom-4 lg:w-[min(640px,calc(100vw-2rem))] lg:rounded-card",
            isPos && "lg:top-16 lg:bottom-4"
          )}
        >
          <AssistantHeader
            surface={surface}
            onMinimize={() => setMinimized(true)}
            onClose={() => setOpen(false)}
          />
          <AssistantChatSurface
            assistant={assistant}
            mode="launcher"
            emptyText={isPos ? t("ai.posEmpty") : t("ai.assistantEmpty")}
            placeholder={isPos ? t("ai.posPlaceholder") : t("ai.askPlaceholder")}
          />
        </section>
      </>
    );
  }

  return (
    <Button
      type="button"
      onPointerDown={startDrag}
      onPointerMove={moveDrag}
      onPointerUp={endDrag}
      onPointerCancel={cancelDrag}
      onClick={() => {
        if (suppressClickRef.current) return;
        openAssistant();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openAssistant();
        }
      }}
      style={fabPosition ? { left: fabPosition.x, top: fabPosition.y, right: "auto", bottom: "auto" } : undefined}
      className={cn(
        "fixed z-[45] h-13 w-13 lg:h-14 lg:w-14 rounded-[18px] bg-primary-600 text-white shadow-e2 grid place-items-center touch-none cursor-grab select-none active:cursor-grabbing",
        "hover:bg-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        !fabPosition && (isPos
          ? "left-4 bottom-[calc(1rem+env(safe-area-inset-bottom))] lg:left-auto lg:right-5 lg:bottom-5"
          : "right-4 bottom-[calc(4.25rem+env(safe-area-inset-bottom))] lg:right-5 lg:bottom-5")
      )}
      aria-label={t("ai.launcherTitle")}
      title={t("ai.launcherTitle")}
    >
      <Sparkles className="w-5 h-5" />
    </Button>
  );
}
