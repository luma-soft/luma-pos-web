export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
  publicBaseUrl: string;
};

type R2Environment = Record<string, string | undefined>;
const CLOUDFLARE_ACCOUNT_ID_PATTERN = /^[0-9a-f]{32}$/i;
const R2_BUCKET_NAME_PATTERN = /^(?=.{3,63}$)[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/;

function requiredValue(env: R2Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error("R2 configuration is incomplete");
  return value;
}

function readAccountId(env: R2Environment): string {
  const accountId = requiredValue(env, "R2_ACCOUNT_ID");
  if (!CLOUDFLARE_ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("R2 account ID is invalid");
  }
  return accountId;
}

function readBucketName(
  env: R2Environment,
  name: "R2_PUBLIC_BUCKET" | "R2_PRIVATE_BUCKET",
): string {
  const bucket = requiredValue(env, name);
  if (!R2_BUCKET_NAME_PATTERN.test(bucket)) {
    throw new Error(`R2 bucket ${name} is invalid`);
  }
  return bucket;
}

function readPublicBaseUrl(env: R2Environment): string {
  const value = requiredValue(env, "R2_PUBLIC_BASE_URL");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("R2 public base URL is invalid");
  }

  if (
    url.protocol !== "https:" ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.port ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("R2 public base URL is invalid");
  }

  return url.origin;
}

export function readR2Config(env: R2Environment): R2Config {
  const publicBucket = readBucketName(env, "R2_PUBLIC_BUCKET");
  const privateBucket = readBucketName(env, "R2_PRIVATE_BUCKET");

  if (publicBucket === privateBucket) {
    throw new Error("R2 public and private buckets must be different");
  }

  return {
    accountId: readAccountId(env),
    accessKeyId: requiredValue(env, "R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredValue(env, "R2_SECRET_ACCESS_KEY"),
    publicBucket,
    privateBucket,
    publicBaseUrl: readPublicBaseUrl(env),
  };
}

export function getR2Config(): R2Config {
  return readR2Config(process.env);
}

export function getPublicMediaUrl(key: string): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${getR2Config().publicBaseUrl}/${encodedKey}`;
}
