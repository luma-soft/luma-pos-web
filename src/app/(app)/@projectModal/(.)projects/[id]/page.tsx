import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProjectDetailDialog } from "@/components/project-detail-dialog";
import { getProjectDetail } from "@/lib/data/projects";
import { getServiceFormOptions } from "@/lib/data/services";
import { ProjectDetailView } from "@/app/(app)/projects/[id]/project-detail-view";

export default async function ProjectDetailModalPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getProjectDetail(id);
  if (!detail) notFound();

  const serviceOptions = detail.project.serviceType
    ? await getServiceFormOptions()
    : null;
  const t = await getTranslations();

  return (
    <ProjectDetailDialog
      title={detail.project.name}
      subtitle={detail.project.customerName ?? t("projects.noCustomer")}
      closeLabel={t("common.close")}
    >
      <ProjectDetailView
        detail={detail}
        serviceOptions={serviceOptions}
        presentation="modal"
      />
    </ProjectDetailDialog>
  );
}
