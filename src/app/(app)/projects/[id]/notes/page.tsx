import { notFound } from "next/navigation";

import { MobileDetailHeader } from "@/components/mobile-detail-header";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getProjectDetail } from "@/lib/data/projects";
import { Routes } from "@/lib/routes";
import { canReadProjectNotes } from "@/lib/mobile/project-note-access";
import { ProjectNotesClient } from "./project-notes-client";

export const dynamic = "force-dynamic";

export default async function ProjectNotesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireStoreContext();
  const detail = await getProjectDetail(context.storeId, id);
  if (!detail) notFound();
  if (!canReadProjectNotes({ ok: true, ...context }, detail.project.serviceType)) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6">
      <MobileDetailHeader
        backHref={Routes.project(id)}
        backLabel="Quay lại công trình"
        title="Ghi chú"
        subtitle={detail.project.name}
      />
      <ProjectNotesClient
        key={id}
        projectId={id}
        canManage={["owner", "manager"].includes(context.role)}
      />
    </main>
  );
}
