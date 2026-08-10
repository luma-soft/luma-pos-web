import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { serviceCustomerRequestAttachments } from "@/db/schema";
import { requireMobileServiceManager } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const gate = await requireMobileServiceManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  const { id, attachmentId } = await params;
  const [attachment] = await db.select({
    bucket: serviceCustomerRequestAttachments.bucket,
    path: serviceCustomerRequestAttachments.path,
  }).from(serviceCustomerRequestAttachments).where(and(
    eq(serviceCustomerRequestAttachments.id, attachmentId),
    eq(serviceCustomerRequestAttachments.requestId, id),
  )).limit(1);
  if (!attachment) return mobileError("errors.notFound", 404);
  const { data, error } = await createSupabaseAdminClient().storage
    .from(attachment.bucket).createSignedUrl(attachment.path, 10 * 60);
  if (error) return mobileError("errors.serverError", 500);
  return mobileOk({ url: data.signedUrl, expiresIn: 600 });
}
