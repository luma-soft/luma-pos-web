import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { projects, serviceCustomerRequests } from "@/db/schema";
import {
  hashCustomerRequestToken,
  isCustomerRequestTokenSubmittable,
  isCustomerRequestTokenViewable,
} from "@/lib/services/customer-request-token";
import { ServiceRequestForm } from "./service-request-form";
import { consumePublicRateLimitCore } from "@/lib/services/customer-request-portal";

export const dynamic = "force-dynamic";

export default async function ServiceRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (token.length < 40) notFound();
  const tokenHash = hashCustomerRequestToken(token);
  const globalLimit = await db.transaction((tx) => consumePublicRateLimitCore(tx, {
    key: "customer-request:page:global",
    limit: 10_000,
    windowSeconds: 60,
  }));
  if (!globalLimit.allowed) notFound();
  const [request] = await db.select({
    projectName: projects.name,
    status: serviceCustomerRequests.status,
    submittedAt: serviceCustomerRequests.submittedAt,
    responseDueAt: serviceCustomerRequests.responseDueAt,
    resolutionDueAt: serviceCustomerRequests.resolutionDueAt,
    respondedAt: serviceCustomerRequests.respondedAt,
    resolvedAt: serviceCustomerRequests.resolvedAt,
    tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
  }).from(serviceCustomerRequests)
    .innerJoin(projects, eq(serviceCustomerRequests.projectId, projects.id))
    .where(eq(serviceCustomerRequests.tokenHash, tokenHash))
    .limit(1);
  if (!request || !isCustomerRequestTokenViewable({
    expiresAt: request.tokenExpiresAt,
  })) notFound();
  const tokenLimit = await db.transaction((tx) => consumePublicRateLimitCore(tx, {
    key: `customer-request:page:token:${tokenHash}`,
    limit: 60,
    windowSeconds: 3600,
  }));
  if (!tokenLimit.allowed) notFound();
  const canSubmit = isCustomerRequestTokenSubmittable({
    status: request.status,
    submittedAt: request.submittedAt,
    expiresAt: request.tokenExpiresAt,
  });

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">LumaPOS Service</p>
        <h1 className="mt-2 text-2xl font-black">Yêu cầu hỗ trợ công trình</h1>
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
