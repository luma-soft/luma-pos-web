import "server-only";

import {
  MAX_SERVICE_EVIDENCE_BYTES,
  SERVICE_EVIDENCE_BUCKET,
  SERVICE_EVIDENCE_MIME_TYPES,
} from "@/lib/services/evidence-storage";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export async function ensureServiceEvidenceBucket() {
  const supabase = createSupabaseAdminClient();
  const { data: buckets, error: listError } = await supabase.storage.listBuckets();
  if (listError) throw listError;
  if (!buckets.some((bucket) => bucket.name === SERVICE_EVIDENCE_BUCKET)) {
    const { error } = await supabase.storage.createBucket(SERVICE_EVIDENCE_BUCKET, {
      public: false,
      fileSizeLimit: MAX_SERVICE_EVIDENCE_BYTES,
      allowedMimeTypes: [...SERVICE_EVIDENCE_MIME_TYPES],
    });
    if (error) throw error;
  } else {
    const { error } = await supabase.storage.updateBucket(SERVICE_EVIDENCE_BUCKET, {
      public: false,
      fileSizeLimit: MAX_SERVICE_EVIDENCE_BYTES,
      allowedMimeTypes: [...SERVICE_EVIDENCE_MIME_TYPES],
    });
    if (error) throw error;
  }
  return supabase;
}
