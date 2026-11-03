import { requireMobileOwner } from "@/lib/mobile/auth";
import { mobileAccepted, mobileGate, mobileOk, mobileError } from "@/lib/mobile/response";
import {
  DATABASE_BACKUP_DATA_INFO,
  listDatabaseBackupRuns,
  requestManualDatabaseBackup,
} from "@/lib/database-backups/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const gate = await requireMobileOwner();
  if (!gate.ok) return mobileGate(gate)!;

  try {
    const runs = await listDatabaseBackupRuns();
    return mobileOk({ runs, dataInfo: DATABASE_BACKUP_DATA_INFO });
  } catch {
    return mobileError("errors.serverError", 500);
  }
}

export async function POST() {
  const gate = await requireMobileOwner();
  if (!gate.ok) return mobileGate(gate)!;

  try {
    const result = await requestManualDatabaseBackup({
      userId: gate.userId,
      storeId: gate.storeId,
    });
    return result.created ? mobileAccepted(result) : mobileOk(result);
  } catch {
    return mobileError("errors.serverError", 500);
  }
}
