"use client";

import { useState, type ComponentProps } from "react";
import { useTranslations } from "next-intl";
import { Ellipsis, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { MobileActionSheet } from "@/components/mobile-detail-nav";
import { MenuAction } from "@/app/(app)/partners/tabs/customer-mobile";
import { ProjectEdit } from "../project-widgets";
import { useProjectDelete } from "./project-delete-button";
import { useProjectCompletion } from "./project-completion-button";

type EditableProject = ComponentProps<typeof ProjectEdit>["project"];

/**
 * Phone navigation-bar "…" menu for a project, like ServiceProjectDetailView on
 * iOS: edit, reopen (when done) and delete. Desktop keeps its inline buttons.
 */
export function ProjectMobileNavActions({
  project,
  customers,
  canEdit,
  canDelete,
  canReopen,
}: {
  project: EditableProject & { id: string; name: string; status: string };
  customers: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
  canReopen: boolean;
}) {
  const t = useTranslations();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const completed = project.status === "done";
  const remove = useProjectDelete(project.id, project.name);
  const completion = useProjectCompletion(project.id, completed);

  if (!canEdit && !canDelete && !(canReopen && completed)) {
    return <span className="size-11 shrink-0" aria-hidden="true" />;
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setMenuOpen(true)}
        aria-label={t("common.actions")}
        aria-haspopup="dialog"
        aria-expanded={menuOpen}
        data-button-radius="pill"
        className="grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface/90 text-ios-accent shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10"
      >
        <span className="grid size-[26px] place-items-center rounded-full border-2 border-current">
          <Ellipsis className="size-4" strokeWidth={3} aria-hidden="true" />
        </span>
      </button>
      <MobileActionSheet open={menuOpen} onClose={() => setMenuOpen(false)}>
        {canEdit && <MenuAction icon={Pencil} label={t("common.edit")} onSelect={() => setEditOpen(true)} />}
        {canReopen && completed && (
          <MenuAction icon={RotateCcw} label={t("projects.reopen")} onSelect={() => void completion.act()} disabled={completion.busy} />
        )}
        {canDelete && (
          <MenuAction icon={Trash2} label={t("common.delete")} onSelect={() => void remove.remove()} disabled={remove.busy} destructive />
        )}
      </MobileActionSheet>
      {canEdit && (
        <ProjectEdit project={project} customers={customers} triggerVariant="none" open={editOpen} onOpenChange={setEditOpen} />
      )}
    </>
  );
}
