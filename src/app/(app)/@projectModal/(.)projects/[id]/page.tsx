import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProjectDetailDialog } from "@/components/project-detail-dialog";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { getProjectDetail } from "@/lib/data/projects";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getServiceFormOptions } from "@/lib/data/services";
import { ProjectDetailView } from "@/app/(app)/projects/[id]/project-detail-view";

export default async function ProjectDetailModalPage({
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
  const t = await getTranslations();

  return (
    <ProjectDetailDialog
      title={detail.project.name}
      subtitle={<PartnerDetailLink kind="customer" partnerId={detail.project.customerId} name={detail.project.customerName ?? t("projects.noCustomer")} />}
      closeLabel={t("common.close")}
    >
      <ProjectDetailView
        detail={detail}
        serviceOptions={serviceOptions}
        presentation="modal"
        canDelete={["owner", "manager"].includes(context.role)}
        offlineScopeId={`${context.storeId}:${context.userId}`}
        storeId={context.storeId}
        serviceFieldRelayEnabled={process.env.LUMAPOS_SYNC_RELAY_ENABLED === "true"
          && process.env.LUMAPOS_SERVICE_FIELD_RELAY_ENABLED === "true"}
        canEditFieldService={["owner", "manager", "technician"].includes(context.role)}
      />
    </ProjectDetailDialog>
  );
}
