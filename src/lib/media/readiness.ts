import { readR2Config } from "@/lib/media/config";

export type ManagedMediaReadinessReport = {
  ready: true;
  requiredCapabilities: ["managed-media-r2-v1"];
  publicBucketReachable: true;
  privateBucketReachable: true;
  publicBaseUrlHttps: true;
};

export async function checkManagedMediaReadiness(
  environment: Record<string, string | undefined>,
  dependencies: { headBucket: (bucket: string) => Promise<void> },
): Promise<ManagedMediaReadinessReport> {
  if (environment.MEDIA_WRITE_PROVIDER?.trim() !== "r2") {
    throw new Error("managed_media_write_provider_not_r2");
  }
  const config = readR2Config(environment);
  try {
    await Promise.all([
      dependencies.headBucket(config.publicBucket),
      dependencies.headBucket(config.privateBucket),
    ]);
  } catch (error) {
    throw new Error("managed_media_bucket_unreachable", { cause: error });
  }
  return {
    ready: true,
    requiredCapabilities: ["managed-media-r2-v1"],
    publicBucketReachable: true,
    privateBucketReachable: true,
    publicBaseUrlHttps: true,
  };
}
