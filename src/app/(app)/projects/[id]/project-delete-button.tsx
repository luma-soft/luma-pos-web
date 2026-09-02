"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Loader2, Trash2 } from "lucide-react";

import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { deleteProject } from "@/lib/actions/extras";
import { Routes } from "@/lib/routes";

export function ProjectDeleteButton({
  projectId,
  projectName,
}: {
  projectId: string;
  projectName: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const dialog = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  async function remove() {
    if (busy) return;
    const confirmed = await dialog.confirm({
      title: t("projects.deleteTitle"),
      description: t("projects.deleteConfirm", { name: projectName }),
      confirmLabel: t("common.delete"),
      variant: "destructive",
    });
    if (!confirmed) return;

    setBusy(true);
    const result = await deleteProject(projectId);
    setBusy(false);
    if (result.ok) {
      router.replace(`${Routes.Services}?tab=projects`);
      router.refresh();
      return;
    }
    await dialog.alert({
      description: t(result.error as never),
      variant: "destructive",
    });
  }

  return (
    <button
      type="button"
      onClick={remove}
      disabled={busy}
      className="inline-flex h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-red-200 px-3 text-xs font-medium text-er hover:bg-red-50 disabled:opacity-50 dark:border-red-900 dark:hover:bg-red-950/40 lg:h-8 lg:min-w-0"
    >
      {busy ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <Trash2 className="h-4 w-4" />
      )}
      {t("common.delete")}
    </button>
  );
}
