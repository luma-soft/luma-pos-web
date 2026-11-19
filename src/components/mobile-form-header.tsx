"use client";

import { Loader2 } from "lucide-react";
import { useTranslations } from "next-intl";

/**
 * Inline navigation bar of a full-screen form on phones (SwiftUI toolbar with
 * `.cancellationAction` / `.confirmationAction`): Cancel, centred title, Save.
 * `formId` lets the Save button submit a form rendered below it.
 */
export function MobileFormHeader({
  title,
  onCancel,
  submitLabel,
  formId,
  onSubmit,
  submitting = false,
}: {
  title: string;
  onCancel: () => void;
  submitLabel: string;
  formId?: string;
  onSubmit?: () => void;
  submitting?: boolean;
}) {
  const t = useTranslations();
  return (
    <div className="sticky top-0 z-10 grid grid-cols-[72px_minmax(0,1fr)_72px] items-center gap-2 bg-canvas/90 px-ios-inset pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] backdrop-blur-xl lg:hidden">
      <button type="button" onClick={onCancel} disabled={submitting} className="min-h-11 justify-self-start text-[17px] text-ios-accent disabled:opacity-40">
        {t("common.cancel")}
      </button>
      <h2 className="truncate text-center text-[17px] font-semibold">{title}</h2>
      <button
        type={formId ? "submit" : "button"}
        form={formId}
        onClick={onSubmit}
        disabled={submitting}
        className="inline-flex min-h-11 items-center justify-self-end gap-1.5 text-[17px] font-semibold text-ios-accent disabled:opacity-40"
      >
        {submitting && <Loader2 className="size-4 animate-spin" aria-hidden="true" />}
        {submitLabel}
      </button>
    </div>
  );
}

/** Section title of an iOS form (16pt semibold secondary). */
export const mobileFormSectionTitle = "px-1 text-[16px] font-semibold text-ios-label-secondary lg:hidden";
