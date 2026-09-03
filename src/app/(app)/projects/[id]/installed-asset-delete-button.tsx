"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { deleteInstalledAsset } from "@/lib/actions/services";

export function InstalledAssetDeleteButton({ assetId, assetName }: {
  assetId: string;
  assetName: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const pending = useRef(false);
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    try {
      const confirmed = await dialog.confirm({
        title: t("services.assets.deleteTitle"),
        description: t("services.assets.deleteConfirm", { name: assetName }),
        confirmLabel: t("services.assets.delete"),
        variant: "destructive",
      });
      if (!confirmed) return;
      const result = await deleteInstalledAsset(assetId);
      if (result.ok) {
        router.refresh();
      } else {
        await dialog.alert({ description: t(result.error as never), variant: "destructive" });
      }
    } catch {
      await dialog.alert({ description: t("errors.serverError"), variant: "destructive" });
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      aria-label={`${t("services.assets.delete")}: ${assetName}`}
      className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg px-3 text-xs font-medium text-er hover:bg-red-50 disabled:opacity-50 dark:hover:bg-red-950/40"
    >
      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
      {t("services.assets.delete")}
    </button>
  );
}
