import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { describe, expect, mock, test } from "bun:test";

mock.module("server-only", () => ({}));

let mockedSupabaseClient: unknown;
mock.module("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => mockedSupabaseClient,
}));

const { readR2Config } = await import("../src/lib/media/config");
const { createObjectKey } = await import("../src/lib/media/object-key");
const { R2ObjectStorage } = await import("../src/lib/media/r2-storage");
const { getObjectStorage } = await import("../src/lib/media/storage");
const { SupabaseObjectStorage } = await import(
  "../src/lib/media/supabase-storage"
);

const R2_ENV = {
  R2_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  R2_ACCESS_KEY_ID: "access-key",
  R2_SECRET_ACCESS_KEY: "secret-key",
  R2_PUBLIC_BUCKET: "public-media",
  R2_PRIVATE_BUCKET: "private-media",
  R2_PUBLIC_BASE_URL: "https://media.lumapos.vn/",
};

Object.assign(process.env, R2_ENV, {
  NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_SERVICE_ROLE_KEY: "service-key",
});

const R2_CONFIG = {
  accountId: R2_ENV.R2_ACCOUNT_ID,
  accessKeyId: R2_ENV.R2_ACCESS_KEY_ID,
  secretAccessKey: R2_ENV.R2_SECRET_ACCESS_KEY,
  publicBucket: R2_ENV.R2_PUBLIC_BUCKET,
  privateBucket: R2_ENV.R2_PRIVATE_BUCKET,
  publicBaseUrl: "https://media.lumapos.vn",
};

function r2WithClient(
  send: (command: unknown) => Promise<unknown>,
): InstanceType<typeof R2ObjectStorage> {
  return new R2ObjectStorage(R2_CONFIG, { send } as unknown as S3Client);
}

function createSupabaseClient() {
  const calls: Array<{ operation: string; bucket: string; key?: string }> = [];
  const fileApi = {
    upload: async (key: string) => {
      calls.push({ operation: "upload", bucket: "", key });
      return { data: { path: key }, error: null };
    },
    download: async (key: string) => {
      calls.push({ operation: "download", bucket: "", key });
      return {
        data: new Blob([new Uint8Array([7, 8, 9])]),
        error: null,
      };
    },
    info: async (key: string) => {
      calls.push({ operation: "info", bucket: "", key });
      return {
        data: {
          size: 3,
          contentType: "image/png",
          etag: "legacy-etag",
        },
        error: null,
      };
    },
    createSignedUploadUrl: async (key: string) => {
      calls.push({ operation: "createSignedUploadUrl", bucket: "", key });
      return { data: { signedUrl: "https://legacy.example/upload" }, error: null };
    },
    createSignedUrl: async (key: string) => {
      calls.push({ operation: "createSignedUrl", bucket: "", key });
      return { data: { signedUrl: "https://legacy.example/download" }, error: null };
    },
    remove: async ([key]: string[]) => {
      calls.push({ operation: "remove", bucket: "", key });
      return { data: [], error: null };
    },
    getPublicUrl: (key: string) => ({
      data: { publicUrl: `https://legacy.example/public/${key}` },
    }),
  };

  return {
    calls,
    client: {
      storage: {
        from: (bucket: string) => {
          const withBucket = Object.fromEntries(
            Object.entries(fileApi).map(([name, method]) => {
              if (name === "getPublicUrl") return [name, method];
              return [
                name,
                async (...args: never[]) => {
                  const result = await (method as (...args: never[]) => unknown)(...args);
                  calls.at(-1)!.bucket = bucket;
                  return result;
                },
              ];
            }),
          );
          return withBucket;
        },
      },
    },
  };
}

test("creates an immutable tenant key without exposing the original filename", () => {
  const key = createObjectKey({
    storeId: "11111111-1111-4111-8111-111111111111",
    domain: "projects",
    mediaId: "22222222-2222-4222-8222-222222222222",
    fileName: "Biên bản Chị Hậu / 0909 123 456.pdf",
    now: new Date("2026-08-30T00:00:00Z"),
  });

  expect(key).toBe(
    "stores/11111111-1111-4111-8111-111111111111/projects/2026/08/22222222-2222-4222-8222-222222222222/original.pdf",
  );
  expect(key).not.toContain("Chi-Hau");
  expect(key).not.toContain("0909");
});

test("rejects unvalidated file extensions from object keys", () => {
  expect(() =>
    createObjectKey({
      storeId: "11111111-1111-4111-8111-111111111111",
      domain: "projects",
      mediaId: "22222222-2222-4222-8222-222222222222",
      fileName: "invoice.pdf.exe",
      now: new Date("2026-08-30T00:00:00Z"),
    }),
  ).toThrow("Unsupported media file extension");
});

test("rejects incomplete R2 credentials", () => {
  expect(() => readR2Config({ R2_ACCOUNT_ID: R2_ENV.R2_ACCOUNT_ID })).toThrow(
    "R2 configuration is incomplete",
  );
});

test("reads a complete R2 configuration with separate public and private buckets", () => {
  expect(readR2Config(R2_ENV)).toEqual(R2_CONFIG);
});

test("rejects malformed R2 configuration values before constructing an endpoint", () => {
  const invalidCases = [
    ["account ID", { R2_ACCOUNT_ID: "acct/../../evil" }],
    ["public bucket", { R2_PUBLIC_BUCKET: "PUBLIC bucket/invalid" }],
    ["private bucket", { R2_PRIVATE_BUCKET: "private_" }],
    ["dotted public bucket", { R2_PUBLIC_BUCKET: "public.media" }],
    ["leading-hyphen bucket", { R2_PUBLIC_BUCKET: "-public-media" }],
    ["trailing-hyphen bucket", { R2_PUBLIC_BUCKET: "public-media-" }],
    ["same buckets", { R2_PRIVATE_BUCKET: R2_ENV.R2_PUBLIC_BUCKET }],
    ["non-HTTPS public URL", { R2_PUBLIC_BASE_URL: "http://media.lumapos.vn" }],
    ["credential-bearing public URL", { R2_PUBLIC_BASE_URL: "https://user:pass@media.lumapos.vn" }],
    ["query-bearing public URL", { R2_PUBLIC_BASE_URL: "https://media.lumapos.vn?token=secret" }],
    ["fragment-bearing public URL", { R2_PUBLIC_BASE_URL: "https://media.lumapos.vn#section" }],
  ] as const;

  for (const [label, overrides] of invalidCases) {
    expect(() => readR2Config({ ...R2_ENV, ...overrides }), label).toThrow();
  }
});

test("R2 presigned PUT URLs bind content type and requested expiry", async () => {
  const url = await new R2ObjectStorage(R2_CONFIG).createUploadUrl({
    bucket: R2_CONFIG.privateBucket,
    key: "stores/store/projects/2026/08/media/original.pdf",
    contentType: "application/pdf",
    expiresInSeconds: 300,
  });
  const parsed = new URL(url);

  expect(parsed.searchParams.get("X-Amz-Expires")).toBe("300");
  expect(parsed.searchParams.get("X-Amz-SignedHeaders")?.split(";"))
    .toContain("content-type");
});

test("R2 presigned download URLs bind the requested bucket, key, and expiry", async () => {
  const key = "stores/store/projects/2026/08/media/original.pdf";
  const url = await new R2ObjectStorage(R2_CONFIG).createDownloadUrl({
    bucket: R2_CONFIG.privateBucket,
    key,
    expiresInSeconds: 120,
  });
  const parsed = new URL(url);

  expect(parsed.host).toBe(
    `${R2_CONFIG.privateBucket}.${R2_CONFIG.accountId}.r2.cloudflarestorage.com`,
  );
  expect(parsed.pathname).toBe(`/${key}`);
  expect(parsed.searchParams.get("X-Amz-Expires")).toBe("120");
  expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toBe("host");
});

test("R2 download presigning uses a GET command with the requested expiry", async () => {
  let signedCommand: unknown;
  let signedOptions: unknown;
  const storage = new R2ObjectStorage(
    R2_CONFIG,
    {} as S3Client,
    (async (_client: unknown, command: unknown, options: unknown) => {
      signedCommand = command;
      signedOptions = options;
      return "https://signed.example/download";
    }) as never,
  );

  await expect(
    storage.createDownloadUrl({
      bucket: "private-media",
      key: "folder/file.pdf",
      expiresInSeconds: 45,
    }),
  ).resolves.toBe("https://signed.example/download");
  expect(signedCommand).toBeInstanceOf(GetObjectCommand);
  expect((signedCommand as GetObjectCommand).input).toMatchObject({
    Bucket: "private-media",
    Key: "folder/file.pdf",
  });
  expect(signedOptions).toMatchObject({ expiresIn: 45 });
});

describe("R2 object adapter", () => {
  test("maps put, get, and delete calls to their bucket/key commands", async () => {
    const commands: unknown[] = [];
    const storage = r2WithClient(async (command) => {
      commands.push(command);
      if (command instanceof PutObjectCommand) return { ETag: "put-etag" };
      if (command instanceof GetObjectCommand) {
        return { Body: { transformToByteArray: async () => new Uint8Array([1, 2]) } };
      }
      return {};
    });
    const input = { bucket: "private-media", key: "folder/file.pdf" };

    await expect(
      storage.put({ ...input, body: new Uint8Array([1, 2]), contentType: "application/pdf" }),
    ).resolves.toEqual({
      sizeBytes: 2,
      contentType: "application/pdf",
      etag: "put-etag",
    });
    await expect(storage.get(input)).resolves.toEqual(new Uint8Array([1, 2]));
    await storage.remove(input);

    expect(commands[0]).toBeInstanceOf(PutObjectCommand);
    expect((commands[0] as PutObjectCommand).input).toMatchObject({
      Bucket: input.bucket,
      Key: input.key,
      ContentType: "application/pdf",
    });
    expect(commands[1]).toBeInstanceOf(GetObjectCommand);
    expect((commands[1] as GetObjectCommand).input).toMatchObject({
      Bucket: input.bucket,
      Key: input.key,
    });
    expect(commands[2]).toBeInstanceOf(DeleteObjectCommand);
    expect((commands[2] as DeleteObjectCommand).input).toMatchObject({
      Bucket: input.bucket,
      Key: input.key,
    });
  });

  test("maps only a missing R2 HEAD response to null", async () => {
    const commands: unknown[] = [];
    const missing = r2WithClient(async (command) => {
      commands.push(command);
      throw Object.assign(new Error("missing"), {
        $metadata: { httpStatusCode: 404 },
      });
    });
    const denied = r2WithClient(async () => {
      throw new Error("denied");
    });
    const input = { bucket: "private-media", key: "folder/file.pdf" };

    await expect(missing.head(input)).resolves.toBeNull();
    await expect(denied.head(input)).rejects.toThrow("denied");
    expect(commands[0]).toBeInstanceOf(HeadObjectCommand);
    expect((commands[0] as HeadObjectCommand).input).toMatchObject({
      Bucket: input.bucket,
      Key: input.key,
    });
  });

  test("returns encoded immutable public URLs", () => {
    expect(
      r2WithClient(async () => ({})).publicUrl({
        key: "stores/store/products/2026/08/media/original file #1.pdf",
      }),
    ).toBe(
      "https://media.lumapos.vn/stores/store/products/2026/08/media/original%20file%20%231.pdf",
    );
  });
});

describe("storage factory and Supabase compatibility adapter", () => {
  test("defaults to R2 and allows an explicit Supabase adapter", () => {
    expect(getObjectStorage()).toBeInstanceOf(R2ObjectStorage);
    expect(getObjectStorage("supabase")).toBeInstanceOf(SupabaseObjectStorage);
  });

  test("keeps legacy Supabase writes on put and rejects unsupported signed uploads", async () => {
    const { client, calls } = createSupabaseClient();
    mockedSupabaseClient = client;
    const storage = new SupabaseObjectStorage("legacy-public", client as never);
    const input = { bucket: "legacy-private", key: "folder/file.pdf" };

    await expect(
      storage.put({ ...input, body: new Uint8Array([7, 8, 9]), contentType: "application/pdf" }),
    ).resolves.toMatchObject({ sizeBytes: 3, contentType: "application/pdf" });
    await expect(
      storage.createUploadUrl({
        ...input,
        contentType: "application/pdf",
        expiresInSeconds: 300,
      }),
    ).rejects.toMatchObject({
      code: "OBJECT_STORAGE_OPERATION_UNSUPPORTED",
      provider: "supabase",
      operation: "createUploadUrl",
    });
    await expect(storage.get(input)).resolves.toEqual(new Uint8Array([7, 8, 9]));
    await expect(storage.head(input)).resolves.toEqual({
      sizeBytes: 3,
      contentType: "image/png",
      etag: "legacy-etag",
    });
    await expect(storage.createDownloadUrl({ ...input, expiresInSeconds: 60 }))
      .resolves.toBe("https://legacy.example/download");
    await storage.remove(input);

    expect(calls.map((call) => [call.operation, call.bucket, call.key])).toEqual([
      ["upload", "legacy-private", "folder/file.pdf"],
      ["download", "legacy-private", "folder/file.pdf"],
      ["info", "legacy-private", "folder/file.pdf"],
      ["createSignedUrl", "legacy-private", "folder/file.pdf"],
      ["remove", "legacy-private", "folder/file.pdf"],
    ]);
    expect(storage.publicUrl({ key: "logo image.png" })).toBe(
      "https://legacy.example/public/logo image.png",
    );
  });

  test("maps Supabase SDK-shaped missing heads to null and propagates other errors", async () => {
    const numeric404 = new SupabaseObjectStorage(
      "legacy-public",
      {
        storage: {
          from: () => ({
            info: async () => ({ data: null, error: { status: 404 } }),
          }),
        },
      } as never,
    );
    const string404 = new SupabaseObjectStorage(
      "legacy-public",
      {
        storage: {
          from: () => ({
            info: async () => ({ data: null, error: { statusCode: "404" } }),
          }),
        },
      } as never,
    );
    const unavailable = Object.assign(new Error("unavailable"), { status: 503 });
    const failing = new SupabaseObjectStorage(
      "legacy-public",
      {
        storage: {
          from: () => ({
            info: async () => ({ data: null, error: unavailable }),
          }),
        },
      } as never,
    );
    const input = { bucket: "legacy-private", key: "folder/file.pdf" };

    await expect(numeric404.head(input)).resolves.toBeNull();
    await expect(string404.head(input)).resolves.toBeNull();
    await expect(failing.head(input)).rejects.toThrow("unavailable");
  });
});
