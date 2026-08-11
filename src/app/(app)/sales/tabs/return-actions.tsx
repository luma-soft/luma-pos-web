"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Pencil, X, XCircle } from "lucide-react";
import { cancelReturn, updateReturnMetadata } from "@/lib/actions/returns";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const REASONS = ["defective", "wrong_item", "changed_mind", "other"] as const;

export function ReturnActions({
  returnId,
  reason,
  note,
}: {
  returnId: string;
  reason: string | null;
  note: string | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [editOpen, setEditOpen] = useState(false);
  const [selectedReason, setSelectedReason] = useState(reason ?? "other");
  const [draftNote, setDraftNote] = useState(note ?? "");
  const [busy, setBusy] = useState<"edit" | "cancel" | null>(null);

  async function saveEdit() {
    if (busy) return;
    setBusy("edit");
    const result = await updateReturnMetadata(returnId, {
      reason: selectedReason as (typeof REASONS)[number],
      note: draftNote,
    });
    setBusy(null);
    if (!result.ok) {
      await dialog.alert({ description: t(result.error as never), variant: "destructive" });
      return;
    }
    setEditOpen(false);
    router.refresh();
  }

  async function onCancel() {
    if (busy) return;
    const confirmed = await dialog.confirm({
      title: t("returns.cancelTitle"),
      description: t("returns.cancelConfirm"),
      confirmLabel: t("returns.cancel"),
      variant: "destructive",
    });
    if (!confirmed) return;
    setBusy("cancel");
    const result = await cancelReturn(returnId);
    setBusy(null);
    if (!result.ok) {
      await dialog.alert({ description: t(result.error as never), variant: "destructive" });
      return;
    }
    router.refresh();
  }

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(true)} disabled={Boolean(busy)}>
        <Pencil className="h-4 w-4" />
        {t("returns.edit")}
      </Button>
      <Button type="button" variant="destructive" size="sm" onClick={onCancel} disabled={Boolean(busy)}>
        {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />}
        {t("returns.cancel")}
      </Button>

      {editOpen && (
        <div className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/45 px-4 py-6 backdrop-blur-[2px]" onMouseDown={() => !busy && setEditOpen(false)}>
          <div role="dialog" aria-modal="true" aria-labelledby="return-edit-title" className="w-full max-w-lg rounded-card border border-border bg-surface shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-border-soft px-4 py-3">
              <h2 id="return-edit-title" className="font-semibold">{t("returns.editTitle")}</h2>
              <button type="button" onClick={() => setEditOpen(false)} disabled={Boolean(busy)} className="grid h-11 w-11 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 lg:h-9 lg:w-9" aria-label={t("common.close")}>
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="space-y-4 p-4">
              <label className="block text-sm font-medium">
                {t("returns.reason")}
                <Select
                  value={selectedReason}
                  onValueChange={setSelectedReason}
                  options={REASONS.map((value) => ({ value, label: t(`returns.reasons.${value}`) }))}
                  rootClassName="mt-1 w-full"
                />
              </label>
              <label className="block text-sm font-medium">
                {t("returns.note")}
                <textarea value={draftNote} onChange={(event) => setDraftNote(event.target.value)} maxLength={1000} rows={5} className="mt-1 w-full resize-y rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 min-h-11 lg:min-h-0 min-h-11 lg:min-h-0" />
              </label>
            </div>
            <div className="flex justify-end gap-2 border-t border-border-soft px-4 py-3">
              <Button type="button" variant="outline" size="sm" onClick={() => setEditOpen(false)} disabled={Boolean(busy)}>{t("common.cancel")}</Button>
              <Button type="button" size="sm" onClick={saveEdit} disabled={Boolean(busy)}>
                {busy === "edit" && <Loader2 className="h-4 w-4 animate-spin" />}
                {t("common.save")}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
