export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
  publicBaseUrl: string;
};

export type PublicMediaConfig = Pick<
  R2Config,
  "publicBucket" | "publicBaseUrl"
>;

export type LocalMediaConfig = {
  root: string;
  publicBucket: string;
  privateBucket: string;
  publicBaseUrl: string;
  signingSecret: string;
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
    url.hostname.endsWith(".") ||
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

export function readPublicMediaConfig(
  env: R2Environment,
): PublicMediaConfig {
  return {
    publicBucket: readBucketName(env, "R2_PUBLIC_BUCKET"),
    publicBaseUrl: readPublicBaseUrl(env),
  };
}

export function readR2Config(env: R2Environment): R2Config {
  const publicMedia = readPublicMediaConfig(env);
  const privateBucket = readBucketName(env, "R2_PRIVATE_BUCKET");

  if (publicMedia.publicBucket === privateBucket) {
    throw new Error("R2 public and private buckets must be different");
  }

  return {
    accountId: readAccountId(env),
    accessKeyId: requiredValue(env, "R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredValue(env, "R2_SECRET_ACCESS_KEY"),
    ...publicMedia,
    privateBucket,
  };
}

function requiredLocalValue(env: R2Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error("Local media configuration is incomplete");
  return value;
}

function readLocalBucket(env: R2Environment, name: string, fallback: string) {
  const bucket = env[name]?.trim() || fallback;
  if (!/^[a-z0-9][a-z0-9_-]{0,62}$/.test(bucket)) {
    throw new Error("Local media bucket name is invalid");
  }
  return bucket;
}

export function readLocalMediaConfig(env: R2Environment): LocalMediaConfig {
  const root = requiredLocalValue(env, "MEDIA_LOCAL_ROOT");
  if (!root.startsWith("/")) throw new Error("MEDIA_LOCAL_ROOT must be an absolute path");
  const publicBaseUrl = requiredLocalValue(env, "LUMAPOS_PUBLIC_URL");
  let publicUrl: URL;
  try {
    publicUrl = new URL(publicBaseUrl);
  } catch {
    throw new Error("LUMAPOS_PUBLIC_URL is invalid");
  }
  if (
    !publicUrl.hostname || publicUrl.username || publicUrl.password ||
    publicUrl.pathname !== "/" || publicUrl.search || publicUrl.hash ||
    (process.env.NODE_ENV === "production" && publicUrl.protocol !== "https:") ||
    !["https:", "http:"].includes(publicUrl.protocol)
  ) {
    throw new Error("LUMAPOS_PUBLIC_URL must be an HTTPS origin in production");
  }
  const signingSecret = requiredLocalValue(env, "MEDIA_LOCAL_SIGNING_SECRET");
  if (new TextEncoder().encode(signingSecret).byteLength < 32) {
    throw new Error("MEDIA_LOCAL_SIGNING_SECRET must contain at least 32 bytes");
  }
  const publicBucket = readLocalBucket(env, "MEDIA_LOCAL_PUBLIC_BUCKET", "products");
  const privateBucket = readLocalBucket(env, "MEDIA_LOCAL_PRIVATE_BUCKET", "private");
  if (publicBucket === privateBucket) throw new Error("Local media buckets must be different");
  return { root, publicBucket, privateBucket, publicBaseUrl: publicUrl.origin, signingSecret };
}

export function getLocalMediaConfig(): LocalMediaConfig {
  return readLocalMediaConfig(process.env);
}

export function getMediaWriteProvider(): "local" | "r2" {
  const configured = process.env.MEDIA_WRITE_PROVIDER?.trim().toLowerCase();
  if (!configured) {
    if (process.env.LUMAPOS_AUTH_PROVIDER?.trim().toLowerCase() === "lumapos") {
      throw new Error("MEDIA_WRITE_PROVIDER must be explicitly set for the self-hosted LumaPOS runtime");
    }
    return "r2";
  }
  if (configured === "r2") return "r2";
  if (configured === "local") return "local";
  throw new Error("MEDIA_WRITE_PROVIDER must be 'local' or 'r2'");
}

export function getPublicMediaConfig(): PublicMediaConfig {
  if (getMediaWriteProvider() === "local") {
    const config = getLocalMediaConfig();
    return {
      publicBucket: config.publicBucket,
      publicBaseUrl: `${config.publicBaseUrl}/api/media/local/public`,
    };
  }
  return readPublicMediaConfig(process.env);
}

export function getR2Config(): R2Config {
  return readR2Config(process.env);
}

export function getPublicMediaUrl(
  key: string,
  config: PublicMediaConfig = getPublicMediaConfig(),
): string {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  return `${config.publicBaseUrl}/${encodedKey}`;
}
