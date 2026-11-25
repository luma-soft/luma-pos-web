import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ProjectDetailDialog } from "@/components/project-detail-dialog";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { Routes } from "@/lib/routes";
import { getProjectDetail } from "@/lib/data/projects";
import { getServiceFormOptions } from "@/lib/data/services";
import { getSyncRelayConfig } from "@/lib/sync/config";
import { ProjectDetailView } from "./project-detail-view";
import { ProjectMobileNavActions } from "@/app/(app)/projects/[id]/project-mobile-nav-actions";
import { requireStoreContext } from "@/lib/auth/store-context";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const context = await requireStoreContext();
  const syncRelayConfig = getSyncRelayConfig();
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
      backLabel={t("common.back")}
      mobileActions={(
        <ProjectMobileNavActions
          project={detail.project}
          customers={serviceOptions?.customerOptions ?? []}
          canEdit={Boolean(serviceOptions) && ["owner", "manager"].includes(context.role)}
          canDelete={["owner", "manager"].includes(context.role)}
          canReopen={Boolean(detail.project.serviceType && serviceOptions) && ["owner", "manager"].includes(context.role)}
        />
      )}
      closeHref={`${Routes.Services}?tab=projects`}
    >
      <ProjectDetailView
        detail={detail}
        serviceOptions={serviceOptions}
        presentation="modal"
        canDelete={["owner", "manager"].includes(context.role)}
        offlineScopeId={`${context.storeId}:${context.userId}`}
        storeId={context.storeId}
        serviceFieldRelayEnabled={syncRelayConfig.serviceFieldEnabled}
        canEditFieldService={["owner", "manager", "technician"].includes(context.role)}
      />
    </ProjectDetailDialog>
  );
}
