import { eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { db } from "@/db";
import { projects, serviceCustomerRequests } from "@/db/schema";
import {
  hashCustomerRequestToken,
  isCustomerRequestTokenUsable,
} from "@/lib/services/customer-request-token";
import { ServiceRequestForm } from "./service-request-form";

export const dynamic = "force-dynamic";

export default async function ServiceRequestPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (token.length < 40) notFound();
  const [request] = await db.select({
    projectName: projects.name,
    contactName: serviceCustomerRequests.contactName,
    contactPhone: serviceCustomerRequests.contactPhone,
    status: serviceCustomerRequests.status,
    tokenExpiresAt: serviceCustomerRequests.tokenExpiresAt,
  }).from(serviceCustomerRequests)
    .innerJoin(projects, eq(serviceCustomerRequests.projectId, projects.id))
    .where(eq(serviceCustomerRequests.tokenHash, hashCustomerRequestToken(token)))
    .limit(1);
  if (!request || !isCustomerRequestTokenUsable({
    status: request.status,
    expiresAt: request.tokenExpiresAt,
  })) notFound();

  return (
    <main className="min-h-screen bg-slate-50 px-4 py-10 text-slate-950">
      <div className="mx-auto max-w-xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-blue-600">LumaPOS Service</p>
        <h1 className="mt-2 text-2xl font-black">Yêu cầu hỗ trợ công trình</h1>
        <p className="mt-2 text-sm text-slate-600">{request.projectName}</p>
        <ServiceRequestForm
          token={token}
          defaultContactName={request.contactName}
          defaultContactPhone={request.contactPhone ?? ""}
        />
      </div>
    </main>
  );
}
