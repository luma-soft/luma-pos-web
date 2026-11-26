import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getServiceRequestPortalView } from "@/lib/data/portal";
import { isCustomerRequestTokenSubmittable } from "@/lib/services/customer-request-token";
import { ServiceRequestForm } from "./service-request-form";

export const dynamic = "force-dynamic";

export default async function ServiceRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const t = await getTranslations("serviceRequestPortal");
  const { token } = await params;
  if (token.length < 40) notFound();
  const request = await getServiceRequestPortalView(token);
  if (!request) notFound();
  const canSubmit = isCustomerRequestTokenSubmittable({
    status: request.status,
    submittedAt: request.submittedAt,
    expiresAt: request.tokenExpiresAt,
  });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">Hải Đăng POS Service</p>
        <h1 className="mt-2 text-2xl font-black">{t("title")}</h1>
        <p className="mt-2 text-sm text-slate-600">{request.projectName}</p>
        <ServiceRequestForm
          token={token}
          initialStatus={{
            code: null,
            title: null,
            priority: null,
            status: request.status,
            submittedAt: request.submittedAt?.toISOString() ?? null,
            responseDueAt: request.responseDueAt?.toISOString() ?? null,
            resolutionDueAt: request.resolutionDueAt?.toISOString() ?? null,
            respondedAt: request.respondedAt?.toISOString() ?? null,
            resolvedAt: request.resolvedAt?.toISOString() ?? null,
          }}
          canSubmit={canSubmit}
        />
      </div>
    </main>
  );
}
