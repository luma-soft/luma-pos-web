export type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBucket: string;
  privateBucket: string;
  publicBaseUrl: string;
};

type R2Environment = Record<string, string | undefined>;

function requiredValue(env: R2Environment, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error("R2 configuration is incomplete");
  return value;
}

export function readR2Config(env: R2Environment): R2Config {
  const publicBucket = requiredValue(env, "R2_PUBLIC_BUCKET");
  const privateBucket = requiredValue(env, "R2_PRIVATE_BUCKET");

  if (publicBucket === privateBucket) {
    throw new Error("R2 public and private buckets must be different");
  }

  return {
    accountId: requiredValue(env, "R2_ACCOUNT_ID"),
    accessKeyId: requiredValue(env, "R2_ACCESS_KEY_ID"),
    secretAccessKey: requiredValue(env, "R2_SECRET_ACCESS_KEY"),
    publicBucket,
    privateBucket,
    publicBaseUrl: requiredValue(env, "R2_PUBLIC_BASE_URL").replace(/\/+$/, ""),
  };
}

export function getR2Config(): R2Config {
  return readR2Config(process.env);
}
