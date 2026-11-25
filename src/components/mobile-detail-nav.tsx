"use client";

import { createContext, useContext, useState, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChevronLeft, Ellipsis, X } from "lucide-react";
import { useModalLayer } from "@/components/ui/use-modal-layer";

/** Lets a detail rendered inside an overlay close that overlay from its own header. */
export const DetailCloseContext = createContext<(() => void) | null>(null);

/**
 * Native detail navigation bar (iOS 26): circular back button, centred title and
 * a circular "…" button that opens the screen's actions as a bottom sheet.
 * Phones only; desktop keeps each screen's own header and action footer.
 */
export function MobileDetailNav({ title, actions }: { title: ReactNode; actions?: ReactNode }) {
  const t = useTranslations();
  const router = useRouter();
  const close = useContext(DetailCloseContext);
  const [menuOpen, setMenuOpen] = useState(false);

  const circle = "grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10";
  return (
    <>
      <div className="sticky top-0 z-20 flex items-center gap-3 bg-canvas/85 px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl lg:hidden">
        <button
          type="button"
          onClick={() => (close ? close() : router.back())}
          aria-label={t("common.back")}
          data-button-radius="pill"
          className={`${circle} text-ios-label`}
        >
          <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
        </button>
        <h1 className="min-w-0 flex-1 truncate text-center text-[17px] font-semibold">{title}</h1>
        {actions ? (
          <button
            type="button"
            onClick={() => setMenuOpen(true)}
            aria-label={t("common.actions")}
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            data-button-radius="pill"
            className={`${circle} text-ios-accent`}
          >
            <span className="grid size-[26px] place-items-center rounded-full border-2 border-current">
              <Ellipsis className="size-4" strokeWidth={3} aria-hidden="true" />
            </span>
          </button>
        ) : <span className="size-11 shrink-0" aria-hidden="true" />}
      </div>
      {actions && <MobileActionSheet open={menuOpen} onClose={() => setMenuOpen(false)}>{actions}</MobileActionSheet>}
    </>
  );
}

/**
 * Native action sheet: grabber, title with a close button and full-width 48pt
 * action rows. Choosing a row marked `data-menu-action` dismisses it.
 */
export function MobileActionSheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  children: ReactNode;
}) {
  const t = useTranslations();
  // Close only the sheet, not the screen underneath.
  const layerSurfaceRef = useRef<HTMLDivElement>(null);
  useModalLayer({ open, onEscape: onClose, elementRef: layerSurfaceRef });
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[120] flex items-end bg-black/35 lg:hidden" onClick={onClose}>
      <div ref={layerSurfaceRef}
        role="dialog"
        aria-modal="true"
        aria-label={typeof title === "string" ? title : t("common.actions")}
        onClick={(event) => {
          event.stopPropagation();
          // Like an iOS menu, choosing an action dismisses the sheet.
          if ((event.target as HTMLElement).closest("[data-menu-action]")) onClose();
        }}
        className="max-h-[80dvh] w-full overflow-y-auto rounded-t-[26px] bg-canvas px-ios-inset pb-[max(1rem,env(safe-area-inset-bottom))] pt-3"
      >
        <div className="mx-auto mb-3 h-[5px] w-9 rounded-full bg-ios-label-tertiary" aria-hidden="true" />
        <div className="mb-3 flex items-center justify-between gap-3">
          <span className="min-w-0 truncate text-[17px] font-semibold">{title ?? t("common.actions")}</span>
          <button type="button" onClick={onClose} aria-label={t("common.close")} data-button-radius="pill" className="grid size-9 shrink-0 place-items-center rounded-full bg-black/[0.06] text-ios-label-secondary dark:bg-white/10">
            <X className="size-4" strokeWidth={2.6} aria-hidden="true" />
          </button>
        </div>
        {/* Actions stack as full-width 48pt rows, like a native action sheet. */}
        <div className="space-y-2 [&_[role=group]]:flex [&_[role=group]]:flex-col [&_[role=group]]:gap-2 [&_[role=group]>*]:!h-12 [&_[role=group]>*]:!w-full [&_[role=group]>*]:!rounded-[14px] [&_[role=group]>*]:!text-[17px] [&_[role=group]>div>button]:!h-12 [&_[role=group]>div>button]:!w-full [&_[role=group]>div>button]:!rounded-[14px] [&_[role=group]>div>button]:!text-[17px]">
          {children}
        </div>
      </div>
    </div>
  );
}
