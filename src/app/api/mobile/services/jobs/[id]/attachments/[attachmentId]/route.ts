import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { serviceAttachments } from "@/db/schema";
import { resolveServiceJobAccess } from "@/lib/data/service-field";
import { requireMobileServiceAccess } from "@/lib/mobile/auth";
import { mobileError, mobileGate, mobileOk } from "@/lib/mobile/response";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; attachmentId: string }> },
) {
  const gate = await requireMobileServiceAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;
  if (!gate.ok) return mobileError("errors.unauthorized", 401);
  const { id, attachmentId } = await params;
  const access = await resolveServiceJobAccess(
    { userId: gate.userId, role: gate.role },
    id,
  );
  if (!access) return mobileError("errors.notFound", 404);
  const [attachment] = await db.select({
    bucket: serviceAttachments.bucket,
    path: serviceAttachments.path,
  }).from(serviceAttachments)
    .where(and(
      eq(serviceAttachments.id, attachmentId),
      eq(serviceAttachments.jobId, id),
      isNull(serviceAttachments.deletedAt),
    ))
    .limit(1);
  if (!attachment) return mobileError("errors.notFound", 404);
  try {
    const supabase = createSupabaseAdminClient();
    const { data, error } = await supabase.storage
      .from(attachment.bucket)
      .createSignedUrl(attachment.path, 15 * 60);
    if (error) throw error;
    return mobileOk({ signedUrl: data.signedUrl });
  } catch (error) {
    console.error("service evidence signing failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
