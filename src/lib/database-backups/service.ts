import { desc, inArray } from "drizzle-orm";
import { db } from "@/db";
import {
  databaseBackupRuns,
  type DatabaseBackupManifest,
  type DatabaseBackupStatus,
  type DatabaseBackupTrigger,
} from "@/db/schema";

export const DATABASE_BACKUP_HISTORY_LIMIT = 50;

export const DATABASE_BACKUP_DATA_INFO = {
  included: [
    {
      id: "rolesAndSchema",
      vi: "Vai trò PostgreSQL và cấu trúc database của ứng dụng",
      en: "PostgreSQL roles and application database schema",
    },
    {
      id: "applicationData",
      vi: "Dữ liệu ứng dụng; có thể gồm email và hash mật khẩu của người dùng Supabase Auth",
      en: "Application data, including Supabase Auth user emails and password hashes when emitted by the dump",
    },
  ],
  excluded: [
    {
      id: "r2Files",
      vi: "Nội dung ảnh và tệp trên Cloudflare R2; database chỉ lưu thông tin tham chiếu",
      en: "Image and file contents stored in Cloudflare R2; the database keeps their references",
    },
    {
      id: "managedObjects",
      vi: "Định nghĩa schema do Supabase quản lý và object thuộc extension",
      en: "Supabase-managed schema definitions and extension-owned objects",
    },
  ],
  storage: {
    vi: "Cloudflare R2 riêng tư · database-backups/",
    en: "Private Cloudflare R2 bucket · database-backups/",
  },
  schedule: {
    vi: "Hằng ngày lúc 01:17 (giờ Việt Nam); yêu cầu thủ công thường được xử lý trong khoảng 5 phút",
    en: "Daily at 01:17 Vietnam time; manual requests are usually processed within about five minutes",
  },
  retention: {
    vi: "Chưa có lịch tự xóa; các bản backup được giữ trong bucket đến khi cấu hình chính sách lưu trữ",
    en: "No automatic deletion is configured; backups stay in the bucket until a retention policy is set",
  },
} as const;

export type DatabaseBackupRunDto = {
  id: string;
  triggerType: DatabaseBackupTrigger;
  status: DatabaseBackupStatus;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMilliseconds: number | null;
  archiveSizeBytes: number | null;
  sha256: string | null;
  manifest: DatabaseBackupManifest | Record<string, never>;
  failureCode: string | null;
};

function toDto(row: typeof databaseBackupRuns.$inferSelect): DatabaseBackupRunDto {
  return {
    id: row.id,
    triggerType: row.triggerType,
    status: row.status,
    requestedAt: row.requestedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    finishedAt: row.finishedAt?.toISOString() ?? null,
    durationMilliseconds: row.durationMilliseconds,
    archiveSizeBytes: row.archiveSizeBytes,
    sha256: row.sha256,
    manifest: row.manifest,
    failureCode: row.failureCode,
  };
}

export async function listDatabaseBackupRuns(): Promise<DatabaseBackupRunDto[]> {
  const rows = await db
    .select()
    .from(databaseBackupRuns)
    .orderBy(desc(databaseBackupRuns.requestedAt))
    .limit(DATABASE_BACKUP_HISTORY_LIMIT);
  return rows.map(toDto);
}

export async function requestManualDatabaseBackup(input: {
  userId: string;
  storeId: string;
}): Promise<{ run: DatabaseBackupRunDto; created: boolean }> {
  const activeStatuses: DatabaseBackupStatus[] = ["queued", "running"];
  const [active] = await db
    .select()
    .from(databaseBackupRuns)
    .where(inArray(databaseBackupRuns.status, activeStatuses))
    .limit(1);
  if (active) return { run: toDto(active), created: false };

  try {
    const [created] = await db
      .insert(databaseBackupRuns)
      .values({
        triggerType: "manual",
        status: "queued",
        requestedByUserId: input.userId,
        requestedByStoreId: input.storeId,
      })
      .returning();
    if (!created) throw new Error("DATABASE_BACKUP_REQUEST_FAILED");
    return { run: toDto(created), created: true };
  } catch (error) {
    const cause = (error as { cause?: { code?: string } })?.cause;
    if (cause?.code !== "23505" && (error as { code?: string })?.code !== "23505") {
      throw error;
    }

    const [activeAfterConflict] = await db
      .select()
      .from(databaseBackupRuns)
      .where(inArray(databaseBackupRuns.status, activeStatuses))
      .limit(1);
    if (!activeAfterConflict) throw error;
    return { run: toDto(activeAfterConflict), created: false };
  }
}
