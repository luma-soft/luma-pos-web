import "server-only";

import { R2ObjectStorage } from "@/lib/media/r2-storage";
import { getLocalFileStorage } from "@/lib/media/local-storage";
import { SupabaseObjectStorage } from "@/lib/media/supabase-storage";
import { getMediaWriteProvider } from "@/lib/media/config";
import { authProvider } from "@/lib/auth/provider";
import type { MediaProvider, ObjectStorage } from "@/lib/media/types";

let r2Storage: ObjectStorage | null = null;
let supabaseStorage: ObjectStorage | null = null;
let localStorage: ObjectStorage | null = null;

export function getObjectStorage(provider: MediaProvider = getMediaWriteProvider()): ObjectStorage {
  if (provider === "supabase" && authProvider() === "lumapos") {
    throw new Error("Supabase object storage is disabled in the self-hosted LumaPOS runtime");
  }
  if (provider === "local") {
    localStorage ??= getLocalFileStorage();
    return localStorage;
  }
  if (provider === "r2") {
    r2Storage ??= new R2ObjectStorage();
    return r2Storage;
  }

  supabaseStorage ??= new SupabaseObjectStorage();
  return supabaseStorage;
}

/** Deliberate source-only access for the one-time media migration command. */
export function getSupabaseMigrationSourceStorage(): ObjectStorage {
  supabaseStorage ??= new SupabaseObjectStorage();
  return supabaseStorage;
}
