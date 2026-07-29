import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { serviceAttachments } from "@/db/schema";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { requireLockedServiceJobAccess } from "@/lib/services/field-operations";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { id, attachmentId } = await params;
  try {
    const supabase = createSupabaseAdminClient();
    const signedUrl = await db.transaction(async (tx) => {
      await requireLockedServiceJobAccess(tx, {
        userId: gate.userId,
        role: gate.role,
      }, id);
      const [attachment] = await tx.select({
        bucket: serviceAttachments.bucket,
        path: serviceAttachments.path,
      }).from(serviceAttachments)
        .where(and(
          eq(serviceAttachments.id, attachmentId),
          eq(serviceAttachments.jobId, id),
          isNull(serviceAttachments.deletedAt),
        ))
        .limit(1);
      if (!attachment) return null;
      const { data, error } = await supabase.storage
        .from(attachment.bucket)
        .createSignedUrl(attachment.path, 15 * 60);
      if (error) throw error;
      return data.signedUrl;
    });
    return signedUrl
      ? mobileOk({ signedUrl })
      : mobileError("errors.notFound", 404);
  } catch (error) {
    if (
      error instanceof Error
      && (
        error.message === "SERVICE_JOB_NOT_FOUND"
        || error.message === "SERVICE_JOB_FORBIDDEN"
      )
    ) return mobileError("errors.notFound", 404);
    console.error("service evidence signing failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
