import { beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { and, asc, eq, isNull } from "drizzle-orm";

const projectRoot = new URL("..", import.meta.url).pathname.replace(/\/$/, "");
const schema = await import(`${projectRoot}/src/db/schema.ts`);
const { mediaObjects, productMedia, products, stockLevels } = schema;
const {
  externalProductImageUrls,
  ProductMediaValidationError,
  imageMediaIdsSchema,
  resolveLegacyProductImageIdsInTransaction,
  replaceProductMediaInTransaction,
} = await import(`${projectRoot}/src/lib/products/product-media.ts`);
const {
  productCompatibilityImageUrls,
  productManagedImageDescriptors,
} = await import(
  `${projectRoot}/src/lib/products/product-media-read.ts`
);

const client = new PGlite();
const database = drizzle(client, { schema });

const STORE_ID = "a0000000-0000-4000-8000-000000000001";
const STORE_B = "20000000-0000-4000-8000-000000000001";
const PRODUCT_ID = "b0000000-0000-4000-8000-000000000001";
const PARENT_ID = "30000000-0000-4000-8000-000000000002";
const CHILD_ID = "30000000-0000-4000-8000-000000000003";
const WAREHOUSE_ID = "40000000-0000-4000-8000-000000000001";
const MEDIA_A = "c0000000-0000-4000-8000-000000000001";
const MEDIA_B = "50000000-0000-4000-8000-000000000002";
const MEDIA_PENDING = "50000000-0000-4000-8000-000000000003";
const MEDIA_PRIVATE = "50000000-0000-4000-8000-000000000004";
const MEDIA_WRONG_PURPOSE = "50000000-0000-4000-8000-000000000005";
const MEDIA_FOREIGN = "50000000-0000-4000-8000-000000000006";
const MEDIA_WRONG_TARGET = "50000000-0000-4000-8000-000000000007";
const MEDIA_PARENT = "50000000-0000-4000-8000-000000000008";
const MEDIA_DELETED = "50000000-0000-4000-8000-000000000009";
const MEDIA_WRONG_FORMAT = "50000000-0000-4000-8000-000000000010";
const MEDIA_SUPABASE = "50000000-0000-4000-8000-000000000011";
const MEDIA_WRONG_BUCKET = "50000000-0000-4000-8000-000000000012";
const MEDIA_READY_DELETED = "50000000-0000-4000-8000-000000000013";
const MEDIA_MIME_MISMATCH = "50000000-0000-4000-8000-000000000014";
const EXTERNAL_A = "https://images.vendor.test/catalog/a.jpg";
const EXTERNAL_B = "https://images.vendor.test/catalog/b.jpg";
const PUBLIC_MEDIA = {
  publicBaseUrl: "https://media.staging.lumapos.test",
  publicBucket: "public-media",
};

function objectKey(storeId, mediaId, extension = "webp") {
  return `stores/${storeId}/products/2026/08/${mediaId}/original.${extension}`;
}

function publicUrl(storeId, mediaId, extension = "webp") {
  return `${PUBLIC_MEDIA.publicBaseUrl}/${objectKey(storeId, mediaId, extension)}`;
}

function mediaValue({
  id,
  storeId = STORE_ID,
  status = "ready",
  visibility = "public",
  purpose = "product-image",
  targetId = storeId,
  domain = "products",
  extension = "webp",
  mimeType = extension === "gif" ? "image/gif" : "image/webp",
  provider = "r2",
  bucket,
  deletedAt = null,
}) {
  return {
    id,
    storeId,
    provider,
    visibility,
    purpose,
    targetId,
    domain,
    bucket: bucket ?? (visibility === "public" ? "public-media" : "private-media"),
    objectKey: objectKey(storeId, id, extension),
    originalFileName: `${id}.${extension}`,
    mimeType,
    sizeBytes: 16,
    status,
    uploadExpiresAt: new Date("2026-08-30T04:00:00.000Z"),
    readyAt: status === "ready" ? new Date("2026-08-30T03:00:00.000Z") : null,
    verifiedAt: status === "ready" ? new Date("2026-08-30T03:00:00.000Z") : null,
    deletedAt,
  };
}

async function applySqlFile(path) {
  for (const statement of readFileSync(path, "utf8")
    .split("--> statement-breakpoint")
    .map((part) => part.trim())
    .filter(Boolean)) {
    if (!/create extension|gin_trgm_ops/i.test(statement)) await client.exec(statement);
  }
}

beforeAll(async () => {
  await client.exec("create role anon; create role authenticated;");
  for (const file of readdirSync(`${projectRoot}/drizzle`)
    .filter((name) => name.endsWith(".sql"))
    .sort()) {
    await applySqlFile(`${projectRoot}/drizzle/${file}`);
  }
  await client.exec(`
    insert into stores (id, slug) values
      ('${STORE_ID}', 'task-5-media-a'),
      ('${STORE_B}', 'task-5-media-b');
    insert into warehouses (id, store_id, name, is_default)
      values ('${WAREHOUSE_ID}', '${STORE_ID}', 'Kho chính', true);
    insert into products (id, store_id, sku, name, image_urls)
      values ('${PRODUCT_ID}', '${STORE_ID}', 'TASK-5', 'Task 5', '[]'::jsonb);
    insert into products (id, store_id, sku, name, image_urls, is_variant_parent)
      values ('${PARENT_ID}', '${STORE_ID}', 'TASK-5-PARENT', 'Task 5 parent', '[]'::jsonb, true);
    insert into products (id, store_id, sku, name, image_urls, parent_product_id, variant_name)
      values ('${CHILD_ID}', '${STORE_ID}', 'TASK-5-CHILD', 'Task 5 child', '[]'::jsonb, '${PARENT_ID}', 'Đen');
    insert into stock_levels (store_id, product_id, warehouse_id, quantity)
      values ('${STORE_ID}', '${PRODUCT_ID}', '${WAREHOUSE_ID}', 37);
  `);
});

beforeEach(async () => {
  await database.delete(productMedia);
  await database.delete(mediaObjects);
  await database.update(products).set({ imageUrls: [] }).where(eq(products.id, PRODUCT_ID));
  await database.update(products).set({ imageUrls: [] }).where(eq(products.id, PARENT_ID));
  await database.update(products).set({ imageUrls: [] }).where(eq(products.id, CHILD_ID));
  await database.update(stockLevels).set({ quantity: "37" }).where(eq(stockLevels.productId, PRODUCT_ID));
  await database.insert(mediaObjects).values([
    mediaValue({ id: MEDIA_A }),
    mediaValue({ id: MEDIA_B, targetId: PRODUCT_ID }),
    mediaValue({ id: MEDIA_PENDING, status: "pending" }),
    mediaValue({ id: MEDIA_PRIVATE, visibility: "private" }),
    mediaValue({
      id: MEDIA_WRONG_PURPOSE,
      purpose: "project-document",
      domain: "projects",
    }),
    mediaValue({ id: MEDIA_FOREIGN, storeId: STORE_B }),
    mediaValue({
      id: MEDIA_WRONG_TARGET,
      targetId: "60000000-0000-4000-8000-000000000001",
    }),
    mediaValue({ id: MEDIA_PARENT, targetId: PARENT_ID }),
    mediaValue({ id: MEDIA_DELETED, status: "deleted" }),
    mediaValue({ id: MEDIA_WRONG_FORMAT, extension: "gif" }),
    mediaValue({
      id: MEDIA_SUPABASE,
      provider: "supabase",
      targetId: PRODUCT_ID,
    }),
    mediaValue({
      id: MEDIA_WRONG_BUCKET,
      bucket: "another-public-bucket",
      targetId: PRODUCT_ID,
    }),
    mediaValue({
      id: MEDIA_READY_DELETED,
      targetId: PRODUCT_ID,
      deletedAt: new Date("2026-08-30T03:05:00.000Z"),
    }),
    mediaValue({
      id: MEDIA_MIME_MISMATCH,
      targetId: PRODUCT_ID,
      extension: "png",
      mimeType: "image/jpeg",
    }),
  ]);
});

async function replace(imageMediaIds, imageUrls) {
  return replaceFor(PRODUCT_ID, imageMediaIds, imageUrls);
}

async function replaceFor(productId, imageMediaIds, imageUrls) {
  return database.transaction((transaction) =>
    replaceProductMediaInTransaction(transaction, {
      storeId: STORE_ID,
      productId,
      imageMediaIds,
      imageUrls,
      publicMedia: PUBLIC_MEDIA,
      now: new Date("2026-08-30T03:30:00.000Z"),
    })
  );
}

describe("product managed media transaction", () => {
  test("stores only external URLs and never requires R2 configuration for URL-only products", () => {
    expect(externalProductImageUrls([
      EXTERNAL_A,
      publicUrl(STORE_ID, MEDIA_A),
      publicUrl(STORE_B, MEDIA_FOREIGN),
      `${publicUrl(STORE_ID, MEDIA_A, "gif")}?untrusted=1`,
      `http://media.staging.lumapos.test/${objectKey(STORE_ID, MEDIA_A)}`,
      `https://media.staging.lumapos.test./${objectKey(STORE_ID, MEDIA_A)}`,
      EXTERNAL_A,
      EXTERNAL_B,
    ], PUBLIC_MEDIA)).toEqual([EXTERNAL_A, EXTERNAL_B]);
  });

  test("uses Task 3 UUIDs, a bounded list, and rejects duplicates instead of deduplicating", () => {
    expect(imageMediaIdsSchema.safeParse([
      "00000000-0000-0000-0000-000000000000",
      "ffffffff-ffff-ffff-ffff-ffffffffffff",
    ]).success).toBe(true);
    expect(imageMediaIdsSchema.safeParse([MEDIA_A, MEDIA_A]).success).toBe(false);
    expect(imageMediaIdsSchema.safeParse(Array.from({ length: 11 }, (_, index) =>
      `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`
    )).success).toBe(false);
    expect(imageMediaIdsSchema.safeParse(["not-a-uuid"]).success).toBe(false);
  });

  test("retargets staging media and replaces ordered rows with one primary", async () => {
    const result = await replace(
      [MEDIA_B, MEDIA_A],
      [EXTERNAL_A, publicUrl(STORE_ID, MEDIA_A), EXTERNAL_B],
    );

    expect(result.imageUrls).toEqual([
      EXTERNAL_A,
      EXTERNAL_B,
      publicUrl(STORE_ID, MEDIA_B),
      publicUrl(STORE_ID, MEDIA_A),
    ]);
    expect(result.media).toEqual([
      { mediaId: MEDIA_B, path: objectKey(STORE_ID, MEDIA_B), url: publicUrl(STORE_ID, MEDIA_B) },
      { mediaId: MEDIA_A, path: objectKey(STORE_ID, MEDIA_A), url: publicUrl(STORE_ID, MEDIA_A) },
    ]);

    const rows = await database.select({
      mediaId: productMedia.mediaObjectId,
      sortOrder: productMedia.sortOrder,
      isPrimary: productMedia.isPrimary,
    }).from(productMedia).where(and(
      eq(productMedia.productId, PRODUCT_ID),
      isNull(productMedia.deletedAt),
    )).orderBy(asc(productMedia.sortOrder));
    expect(rows).toEqual([
      { mediaId: MEDIA_B, sortOrder: 0, isPrimary: true },
      { mediaId: MEDIA_A, sortOrder: 1, isPrimary: false },
    ]);
    const targets = await database.select({ id: mediaObjects.id, targetId: mediaObjects.targetId })
      .from(mediaObjects).where(eq(mediaObjects.storeId, STORE_ID));
    expect(targets.find((row) => row.id === MEDIA_A)?.targetId).toBe(PRODUCT_ID);
    const [product] = await database.select({ imageUrls: products.imageUrls })
      .from(products).where(eq(products.id, PRODUCT_ID));
    expect(product.imageUrls).toEqual([EXTERNAL_A, EXTERNAL_B]);
    const [catalogProduct] = await database.select({
      imageUrls: productCompatibilityImageUrls(STORE_ID, PUBLIC_MEDIA),
    }).from(products).where(eq(products.id, PRODUCT_ID));
    expect(catalogProduct.imageUrls).toEqual(result.imageUrls);
  });

  test("honors UUID-equivalent casing without rewriting the immutable object key", async () => {
    const result = await database.transaction((transaction) =>
      replaceProductMediaInTransaction(transaction, {
        storeId: STORE_ID.toUpperCase(),
        productId: PRODUCT_ID.toUpperCase(),
        imageMediaIds: [MEDIA_A.toUpperCase()],
        imageUrls: [],
        publicMedia: PUBLIC_MEDIA,
        now: new Date("2026-08-30T03:30:00.000Z"),
      })
    );

    expect(result.media).toEqual([{
      mediaId: MEDIA_A,
      path: objectKey(STORE_ID, MEDIA_A),
      url: publicUrl(STORE_ID, MEDIA_A),
    }]);
    expect(await database.transaction((transaction) =>
      resolveLegacyProductImageIdsInTransaction(transaction, {
        storeId: STORE_ID.toUpperCase(),
        productId: PRODUCT_ID.toUpperCase(),
        imageUrls: [publicUrl(STORE_ID, MEDIA_A)],
        publicMedia: PUBLIC_MEDIA,
      })
    )).toEqual([MEDIA_A]);
  });

  test("rejects unknown, cross-store, wrong-state, wrong-purpose, wrong-target, and non-canonical IDs atomically", async () => {
    const invalid = [
      "70000000-0000-4000-8000-000000000001",
      MEDIA_FOREIGN,
      MEDIA_PENDING,
      MEDIA_PRIVATE,
      MEDIA_WRONG_PURPOSE,
      MEDIA_WRONG_TARGET,
      MEDIA_DELETED,
      MEDIA_WRONG_FORMAT,
      MEDIA_SUPABASE,
      MEDIA_WRONG_BUCKET,
      MEDIA_READY_DELETED,
      MEDIA_MIME_MISMATCH,
    ];
    for (const mediaId of invalid) {
      await expect(replace([mediaId], [EXTERNAL_A])).rejects.toBeInstanceOf(
        ProductMediaValidationError,
      );
      const active = await database.select().from(productMedia)
        .where(and(eq(productMedia.productId, PRODUCT_ID), isNull(productMedia.deletedAt)));
      expect(active, mediaId).toEqual([]);
      const [product] = await database.select({ imageUrls: products.imageUrls })
        .from(products).where(eq(products.id, PRODUCT_ID));
      expect(product.imageUrls, mediaId).toEqual([]);
    }
  });

  test("recovers only store-staged or same-product IDs from legacy compatibility URLs", async () => {
    const resolved = await database.transaction((transaction) =>
      resolveLegacyProductImageIdsInTransaction(transaction, {
        storeId: STORE_ID,
        productId: PRODUCT_ID,
        imageUrls: [
          EXTERNAL_A,
          publicUrl(STORE_ID, MEDIA_A),
          publicUrl(STORE_ID, MEDIA_B),
          publicUrl(STORE_ID, MEDIA_A),
          publicUrl(STORE_B, MEDIA_FOREIGN),
          publicUrl(STORE_ID, MEDIA_WRONG_TARGET),
        ],
        publicMedia: PUBLIC_MEDIA,
      })
    );
    expect(resolved).toEqual([MEDIA_A, MEDIA_B]);

    const childResolved = await database.transaction((transaction) =>
      resolveLegacyProductImageIdsInTransaction(transaction, {
        storeId: STORE_ID,
        productId: CHILD_ID,
        imageUrls: [
          publicUrl(STORE_ID, MEDIA_PARENT),
          publicUrl(STORE_ID, MEDIA_A),
        ],
        publicMedia: PUBLIC_MEDIA,
      })
    );
    expect(childResolved).toEqual([MEDIA_A]);
  });

  test("old browse-shaped edits recover, reorder, and remove managed IDs without destructive empty input", async () => {
    await replace([MEDIA_A, MEDIA_B], [EXTERNAL_A]);
    const [browseRow] = await database.select({
      imageUrls: productCompatibilityImageUrls(STORE_ID, PUBLIC_MEDIA),
    }).from(products).where(eq(products.id, PRODUCT_ID));
    expect(browseRow).not.toHaveProperty("imageMedia");

    const applyOldBrowsePatch = (imageUrls) => database.transaction(async (transaction) => {
      const recoveredIds = await resolveLegacyProductImageIdsInTransaction(transaction, {
        storeId: STORE_ID,
        productId: PRODUCT_ID,
        imageUrls,
        publicMedia: PUBLIC_MEDIA,
      });
      return replaceProductMediaInTransaction(transaction, {
        storeId: STORE_ID,
        productId: PRODUCT_ID,
        imageMediaIds: recoveredIds,
        imageUrls,
        publicMedia: PUBLIC_MEDIA,
        now: new Date("2026-08-30T03:30:00.000Z"),
      });
    });

    await applyOldBrowsePatch(browseRow.imageUrls);
    let active = await database.select({
      mediaId: productMedia.mediaObjectId,
      sortOrder: productMedia.sortOrder,
    }).from(productMedia).where(and(
      eq(productMedia.productId, PRODUCT_ID),
      isNull(productMedia.deletedAt),
    )).orderBy(asc(productMedia.sortOrder));
    expect(active).toEqual([
      { mediaId: MEDIA_A, sortOrder: 0 },
      { mediaId: MEDIA_B, sortOrder: 1 },
    ]);

    await applyOldBrowsePatch([
      publicUrl(STORE_ID, MEDIA_B),
      publicUrl(STORE_ID, MEDIA_A),
      EXTERNAL_B,
    ]);
    active = await database.select({
      mediaId: productMedia.mediaObjectId,
      sortOrder: productMedia.sortOrder,
    }).from(productMedia).where(and(
      eq(productMedia.productId, PRODUCT_ID),
      isNull(productMedia.deletedAt),
    )).orderBy(asc(productMedia.sortOrder));
    expect(active).toEqual([
      { mediaId: MEDIA_B, sortOrder: 0 },
      { mediaId: MEDIA_A, sortOrder: 1 },
    ]);

    await applyOldBrowsePatch([publicUrl(STORE_ID, MEDIA_B), EXTERNAL_B]);
    const mediaStatuses = await database.select({
      id: mediaObjects.id,
      status: mediaObjects.status,
    }).from(mediaObjects).where(and(
      eq(mediaObjects.storeId, STORE_ID),
      eq(mediaObjects.domain, "products"),
    ));
    expect(mediaStatuses.find((row) => row.id === MEDIA_A)?.status).toBe("deleted");
    expect(mediaStatuses.find((row) => row.id === MEDIA_B)?.status).toBe("ready");
    active = await database.select({
      mediaId: productMedia.mediaObjectId,
      sortOrder: productMedia.sortOrder,
    }).from(productMedia).where(and(
      eq(productMedia.productId, PRODUCT_ID),
      isNull(productMedia.deletedAt),
    ));
    expect(active).toEqual([{ mediaId: MEDIA_B, sortOrder: 0 }]);
  });

  test("removal soft-deletes the association and now-unreferenced managed object", async () => {
    await replace([MEDIA_A, MEDIA_B], [publicUrl(STORE_ID, MEDIA_A), EXTERNAL_A]);
    await replace([MEDIA_B], [EXTERNAL_A, publicUrl(STORE_ID, MEDIA_B)]);

    const [removedAssociation] = await database.select({ deletedAt: productMedia.deletedAt })
      .from(productMedia).where(and(
        eq(productMedia.productId, PRODUCT_ID),
        eq(productMedia.mediaObjectId, MEDIA_A),
      ));
    const [removedMedia] = await database.select({ status: mediaObjects.status })
      .from(mediaObjects).where(eq(mediaObjects.id, MEDIA_A));
    expect(removedAssociation.deletedAt).toBeInstanceOf(Date);
    expect(removedMedia.status).toBe("deleted");
    const [stock] = await database.select({ quantity: stockLevels.quantity })
      .from(stockLevels).where(eq(stockLevels.productId, PRODUCT_ID));
    expect(stock.quantity).toBe("37.0000");
    const [catalogProduct] = await database.select({
      imageUrls: productCompatibilityImageUrls(STORE_ID, PUBLIC_MEDIA),
    }).from(products).where(eq(products.id, PRODUCT_ID));
    expect(catalogProduct.imageUrls).toEqual([
      EXTERNAL_A,
      publicUrl(STORE_ID, MEDIA_B),
    ]);
  });

  test("preserves only live parent-associated media for variants and refreshes untouched inheritance", async () => {
    const parentUrl = publicUrl(STORE_ID, MEDIA_PARENT);
    await replaceFor(PARENT_ID, [MEDIA_PARENT], [EXTERNAL_A, parentUrl]);

    const [storedChild] = await database.select({ imageUrls: products.imageUrls })
      .from(products).where(eq(products.id, CHILD_ID));
    expect(storedChild.imageUrls).toEqual([EXTERNAL_A]);
    const [inherited] = await database.select({
      imageUrls: productCompatibilityImageUrls(STORE_ID, PUBLIC_MEDIA),
    }).from(products).where(eq(products.id, CHILD_ID));
    expect(inherited.imageUrls).toEqual([EXTERNAL_A, parentUrl]);

    await replaceFor(CHILD_ID, [], [
      EXTERNAL_A,
      publicUrl(STORE_ID, MEDIA_A),
      parentUrl,
    ]);
    const [preserved] = await database.select({
      imageUrls: productCompatibilityImageUrls(STORE_ID, PUBLIC_MEDIA),
    }).from(products).where(eq(products.id, CHILD_ID));
    expect(preserved.imageUrls).toEqual([EXTERNAL_A, parentUrl]);
    expect(await database.select().from(productMedia).where(and(
      eq(productMedia.productId, CHILD_ID),
      isNull(productMedia.deletedAt),
    ))).toEqual([]);

    await replaceFor(PARENT_ID, [], [EXTERNAL_B]);
    const [storedRefreshed] = await database.select({ imageUrls: products.imageUrls })
      .from(products).where(eq(products.id, CHILD_ID));
    expect(storedRefreshed.imageUrls).toEqual([EXTERNAL_B]);
    const [refreshed] = await database.select({
      imageUrls: productCompatibilityImageUrls(STORE_ID, PUBLIC_MEDIA),
    }).from(products).where(eq(products.id, CHILD_ID));
    expect(refreshed.imageUrls).toEqual([EXTERNAL_B]);
  });

  test("omits provider, bucket, deleted, and MIME-incompatible coordinates from every read projection", async () => {
    await database.insert(productMedia).values([
      MEDIA_SUPABASE,
      MEDIA_WRONG_BUCKET,
      MEDIA_READY_DELETED,
      MEDIA_MIME_MISMATCH,
    ].map((mediaId, sortOrder) => ({
      storeId: STORE_ID,
      productId: PRODUCT_ID,
      mediaObjectId: mediaId,
      sortOrder,
      isPrimary: false,
    })));

    const [row] = await database.select({
      imageUrls: productCompatibilityImageUrls(STORE_ID, PUBLIC_MEDIA),
      imageMedia: productManagedImageDescriptors(
        STORE_ID,
        PUBLIC_MEDIA,
      ),
    }).from(products).where(eq(products.id, PRODUCT_ID));
    expect(row).toEqual({ imageUrls: [], imageMedia: [] });
  });
});
