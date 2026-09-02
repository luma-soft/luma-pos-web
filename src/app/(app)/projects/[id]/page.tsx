import { notFound } from "next/navigation";
import { getProjectDetail } from "@/lib/data/projects";
import { getServiceFormOptions } from "@/lib/data/services";
import { ProjectDetailView } from "./project-detail-view";
import { requireStoreContext } from "@/lib/auth/store-context";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireStoreContext();
  const detail = await getProjectDetail(context.storeId, id);
  if (!detail) notFound();

  const serviceOptions = detail.project.serviceType
    ? await getServiceFormOptions(context.storeId)
    : null;

  return (
    <ProjectDetailView
      detail={detail}
      serviceOptions={serviceOptions}
      presentation="page"
      canDelete={["owner", "manager"].includes(context.role)}
    />
  );
}
