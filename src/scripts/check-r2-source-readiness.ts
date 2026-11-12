import { HeadObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { loadEnvConfig } from "@next/env";
import postgres from "postgres";

import { readR2SourceConfig } from "@/lib/media/config";
import { getLocalPostgresTarget } from "./local-postgres-target";

loadEnvConfig(process.cwd());

type SourceSample = { visibility: "public" | "private"; bucket: string; object_key: string };

const report = {
  ready: false,
  requiredCapabilities: ["r2-source-object-read-v1"],
  sourceCredentialsConfigured: false,
  rehearsalDatabaseReachable: false,
  publicSourceObjectPresent: false,
  publicSourceObjectReadable: null as boolean | null,
  privateSourceObjectPresent: false,
  privateSourceObjectReadable: null as boolean | null,
};

let database: ReturnType<typeof postgres> | null = null;
let client: S3Client | null = null;
try {
  const databaseName = process.env.LUMAPOS_LOCAL_DATABASE_NAME?.trim();
  if (!databaseName || databaseName === "lumapos_local") {
    throw new Error("explicit_rehearsal_database_required");
  }

  const target = getLocalPostgresTarget();
  database = postgres(target.url.toString(), { max: 1, prepare: false });
  const samples = await database<SourceSample[]>`
    SELECT DISTINCT ON (visibility) visibility, bucket, object_key
    FROM public.media_objects
    WHERE provider = 'r2' AND status = 'ready'
    ORDER BY visibility, created_at, id
  `;
  report.rehearsalDatabaseReachable = true;

  const sampleByVisibility = new Map(samples.map((row) => [row.visibility, row]));
  report.publicSourceObjectPresent = sampleByVisibility.has("public");
  report.privateSourceObjectPresent = sampleByVisibility.has("private");

  const config = readR2SourceConfig(process.env);
  report.sourceCredentialsConfigured = true;
  client = new S3Client({
    region: "auto",
    endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
    forcePathStyle: true,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
  const canReadSample = async (sample: SourceSample | undefined) => {
    if (!sample) return true;
    try {
      await client!.send(new HeadObjectCommand({
        Bucket: sample.bucket,
        Key: sample.object_key,
      }));
      return true;
    } catch {
      return false;
    }
  };

  if (report.publicSourceObjectPresent) {
    report.publicSourceObjectReadable = await canReadSample(sampleByVisibility.get("public"));
  }
  if (report.privateSourceObjectPresent) {
    report.privateSourceObjectReadable = await canReadSample(sampleByVisibility.get("private"));
  }
  report.ready = report.rehearsalDatabaseReachable
    && report.sourceCredentialsConfigured
    && (!report.publicSourceObjectPresent || report.publicSourceObjectReadable === true)
    && (!report.privateSourceObjectPresent || report.privateSourceObjectReadable === true);
} catch {
  report.ready = false;
} finally {
  client?.destroy();
  await database?.end({ timeout: 5 }).catch(() => undefined);
  console.log(JSON.stringify(report, null, 2));
}

if (!report.ready) process.exitCode = 1;
