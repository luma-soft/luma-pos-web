/** Operations-only: prints the Google Drive backup archives, newest first, as one JSON line. */
import { loadEnvConfig } from "@next/env";
import { listGoogleDriveBackupArchives, readGoogleDriveBackupReadiness } from "@/lib/ops/google-drive-backups";

loadEnvConfig(process.cwd());

const readiness = await readGoogleDriveBackupReadiness({ applicationRoot: process.cwd() });
if (!readiness.configured) {
  console.error(`Google Drive is not reachable (${readiness.blockers.join(", ")})`);
  process.exit(69);
}
const archives = await listGoogleDriveBackupArchives({ limit: 60 });
console.log(JSON.stringify({ archives }));
