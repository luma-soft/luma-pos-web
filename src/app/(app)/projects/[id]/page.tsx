import { notFound } from "next/navigation";
import { getProjectDetail } from "@/lib/data/projects";
import { getServiceFormOptions } from "@/lib/data/services";
import { ProjectDetailView } from "./project-detail-view";

export default async function ProjectDetailPage({
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

  return (
    <ProjectDetailView
      detail={detail}
      serviceOptions={serviceOptions}
      presentation="page"
    />
  );
}
