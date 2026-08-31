import { HeadBucketCommand, S3Client } from "@aws-sdk/client-s3";

import { checkManagedMediaReadiness } from "@/lib/media/readiness";

try {
  const report = await checkManagedMediaReadiness(process.env, {
    headBucket: async (bucket) => {
      const accountId = process.env.R2_ACCOUNT_ID?.trim();
      const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim();
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim();
      if (!accountId || !accessKeyId || !secretAccessKey) {
        throw new Error("managed_media_configuration_incomplete");
      }
      const client = new S3Client({
        region: "auto",
        endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
        credentials: { accessKeyId, secretAccessKey },
      });
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
    },
  });

  console.log(JSON.stringify(report, null, 2));
} catch {
  console.error(
    JSON.stringify(
      {
        ready: false,
        requiredCapabilities: ["managed-media-r2-v1"],
        publicBucketReachable: false,
        privateBucketReachable: false,
        publicBaseUrlHttps: false,
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
}
