import { requireStoreContext } from "@/lib/auth/store-context";
import {
  DATABASE_BACKUP_DATA_INFO,
  listDatabaseBackupRuns,
  requestManualDatabaseBackup,
} from "@/lib/database-backups/service";

export const dynamic = "force-dynamic";

export async function GET() {
  let context;
  try {
    context = await requireStoreContext();
  } catch {
    return Response.json({ ok: false, error: "errors.unauthorized" }, { status: 401 });
  }
  if (context.role !== "owner") {
    return Response.json({ ok: false, error: "errors.forbidden" }, { status: 403 });
  }

  try {
    const runs = await listDatabaseBackupRuns();
    return Response.json({
      ok: true,
      data: {
        runs,
        dataInfo: DATABASE_BACKUP_DATA_INFO,
      },
    });
  } catch {
    return Response.json({ ok: false, error: "errors.serverError" }, { status: 500 });
  }
}

export async function POST() {
  let context;
  try {
    context = await requireStoreContext();
  } catch {
    return Response.json({ ok: false, error: "errors.unauthorized" }, { status: 401 });
  }
  if (context.role !== "owner") {
    return Response.json({ ok: false, error: "errors.forbidden" }, { status: 403 });
  }

  try {
    const result = await requestManualDatabaseBackup({
      userId: context.userId,
      storeId: context.storeId,
    });
    return Response.json({ ok: true, data: result }, { status: result.created ? 202 : 200 });
  } catch {
    return Response.json({ ok: false, error: "errors.serverError" }, { status: 500 });
  }
}
