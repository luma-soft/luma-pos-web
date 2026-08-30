import "server-only";

import { R2ObjectStorage } from "@/lib/media/r2-storage";
import { SupabaseObjectStorage } from "@/lib/media/supabase-storage";
import type { MediaProvider, ObjectStorage } from "@/lib/media/types";

let r2Storage: ObjectStorage | null = null;
let supabaseStorage: ObjectStorage | null = null;

export function getObjectStorage(provider: MediaProvider = "r2"): ObjectStorage {
  if (provider === "r2") {
    r2Storage ??= new R2ObjectStorage();
    return r2Storage;
  }

  supabaseStorage ??= new SupabaseObjectStorage();
  return supabaseStorage;
}
