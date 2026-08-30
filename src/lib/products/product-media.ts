import { and, asc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "@/db";
import { mediaObjects, productMedia, products } from "@/db/schema";
import { parseProductImagePublicUrl } from "@/lib/images/product-image-coordinate";
import {
  getPublicMediaUrl,
  type PublicMediaConfig,
} from "@/lib/media/config";
import { softDeleteMediaIfUnreferencedInTransaction } from "@/lib/media/repository-core";
import { productMediaEligibilitySql } from "@/lib/products/product-media-eligibility";
import { imageMediaIdsSchema } from "@/lib/products/product-media-schema";

export { imageMediaIdsSchema } from "@/lib/products/product-media-schema";

export type ProductManagedImage = {
  mediaId: string;
  url: string;
  path: string;
};

export class ProductMediaValidationError extends Error {
  readonly error = "errors.invalidData";

  constructor() {
    super("PRODUCT_MEDIA_INVALID");
    this.name = "ProductMediaValidationError";
  }
}

type ProductMediaTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];

export async function resolveLegacyProductImageIdsInTransaction(
  transaction: ProductMediaTransaction,
  input: {
    storeId: string;
    productId: string;
    imageUrls: readonly string[];
    publicMedia: PublicMediaConfig;
  },
): Promise<string[]> {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const url of input.imageUrls) {
    const coordinate = parseProductImagePublicUrl(url, input.publicMedia);
    if (
      !coordinate
      || coordinate.storeId !== input.storeId
      || seen.has(coordinate.mediaId)
    ) continue;
    ids.push(coordinate.mediaId);
    seen.add(coordinate.mediaId);
  }
  if (ids.length === 0) return [];

  const owned = await transaction.select({ id: mediaObjects.id })
    .from(mediaObjects)
    .where(and(
      eq(mediaObjects.storeId, input.storeId),
      inArray(mediaObjects.id, ids),
      or(
        eq(mediaObjects.targetId, input.storeId),
        eq(mediaObjects.targetId, input.productId),
      ),
      productMediaEligibilitySql(mediaObjects, {
        storeId: input.storeId,
        targetIds: [input.storeId, input.productId],
        publicMedia: input.publicMedia,
      }),
    ));
  const ownedIds = new Set(owned.map((record) => record.id));
  return ids.filter((id) => ownedIds.has(id));
}

export function externalProductImageUrls(
  requestedUrls: readonly string[],
  publicMedia: Pick<PublicMediaConfig, "publicBaseUrl">,
) {
  const configuredHost = new URL(publicMedia.publicBaseUrl).hostname;
  const seen = new Set<string>();
  const ordered: string[] = [];
  for (const raw of requestedUrls) {
    const url = raw.trim();
    if (!url || seen.has(url)) continue;
    try {
      const parsed = new URL(url);
      if (parsed.hostname.replace(/\.$/, "") === configuredHost) continue;
    } catch {
      // The product schema retains legacy non-URL values for compatibility.
    }
    ordered.push(url);
    seen.add(url);
  }
  return ordered;
}

function sameOrderedUrls(left: unknown, right: unknown): boolean {
  if (!Array.isArray(left) || !Array.isArray(right)) {
    return left == null && right == null;
  }
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export async function replaceProductMediaInTransaction(
  transaction: ProductMediaTransaction,
  input: {
    storeId: string;
    productId: string;
    imageMediaIds: readonly string[];
    imageUrls: readonly string[];
    publicMedia: PublicMediaConfig;
    now?: Date;
  },
): Promise<{
  imageUrls: string[];
  externalImageUrls: string[];
  media: ProductManagedImage[];
}> {
  const parsedIds = imageMediaIdsSchema.safeParse(input.imageMediaIds);
  if (!parsedIds.success) throw new ProductMediaValidationError();
  const ids = parsedIds.data;
  const changedAt = input.now ?? new Date();

  const [coordinates] = await transaction.select({
    parentProductId: products.parentProductId,
  }).from(products).where(and(
    eq(products.storeId, input.storeId),
    eq(products.id, input.productId),
  )).limit(1);
  if (!coordinates) throw new ProductMediaValidationError();
  if (coordinates.parentProductId) {
    const [parent] = await transaction.select({ id: products.id })
      .from(products).where(and(
        eq(products.storeId, input.storeId),
        eq(products.id, coordinates.parentProductId),
      )).limit(1).for("share");
    if (!parent) throw new ProductMediaValidationError();
  }
  const [product] = await transaction.select({
    parentProductId: products.parentProductId,
    isVariantParent: products.isVariantParent,
    imageUrls: products.imageUrls,
  }).from(products).where(and(
    eq(products.storeId, input.storeId),
    eq(products.id, input.productId),
  )).limit(1).for("update");
  if (
    !product
    || product.parentProductId !== coordinates.parentProductId
  ) {
    throw new ProductMediaValidationError();
  }

  const existing = await transaction
    .select({
      mediaId: productMedia.mediaObjectId,
      objectKey: mediaObjects.objectKey,
    })
    .from(productMedia)
    .innerJoin(mediaObjects, and(
      eq(mediaObjects.storeId, productMedia.storeId),
      eq(mediaObjects.id, productMedia.mediaObjectId),
    ))
    .where(and(
      eq(productMedia.storeId, input.storeId),
      eq(productMedia.productId, input.productId),
      isNull(productMedia.deletedAt),
    ))
    .orderBy(asc(productMedia.sortOrder));

  const eligible = productMediaEligibilitySql(mediaObjects, {
    storeId: input.storeId,
    targetIds: [input.storeId, input.productId],
    publicMedia: input.publicMedia,
  });
  const records = ids.length === 0
    ? []
    : await transaction
        .select({
          id: mediaObjects.id,
          storeId: mediaObjects.storeId,
          visibility: mediaObjects.visibility,
          purpose: mediaObjects.purpose,
          targetId: mediaObjects.targetId,
          domain: mediaObjects.domain,
          objectKey: mediaObjects.objectKey,
          status: mediaObjects.status,
        })
        .from(mediaObjects)
        .where(and(
          eq(mediaObjects.storeId, input.storeId),
          inArray(mediaObjects.id, ids),
          eligible,
        ))
        .for("update");
  const byId = new Map(records.map((record) => [record.id, record]));
  const orderedRecords = ids.map((id) => byId.get(id));
  const orderedUrls = orderedRecords.map((record) =>
    record ? getPublicMediaUrl(record.objectKey, input.publicMedia) : null
  );
  const orderedCoordinates = orderedUrls.map((url) =>
    url ? parseProductImagePublicUrl(url, input.publicMedia) : null
  );
  if (
    orderedRecords.some((record, index) =>
      !record
      || record.storeId !== input.storeId
      || record.status !== "ready"
      || record.visibility !== "public"
      || record.purpose !== "product-image"
      || record.domain !== "products"
      || (
        record.targetId !== input.storeId
        && record.targetId !== input.productId
      )
      || !orderedCoordinates[index]
      || orderedCoordinates[index]?.storeId !== input.storeId
      || orderedCoordinates[index]?.mediaId !== record.id
      || orderedCoordinates[index]?.path !== record.objectKey
    )
  ) {
    throw new ProductMediaValidationError();
  }

  if (ids.length > 0) {
    await transaction.update(mediaObjects).set({ targetId: input.productId }).where(and(
      eq(mediaObjects.storeId, input.storeId),
      inArray(mediaObjects.id, ids),
      eq(mediaObjects.targetId, input.storeId),
    ));
  }

  await transaction.update(productMedia).set({
    isPrimary: false,
    deletedAt: changedAt,
  }).where(and(
    eq(productMedia.storeId, input.storeId),
    eq(productMedia.productId, input.productId),
    isNull(productMedia.deletedAt),
  ));

  for (const [sortOrder, mediaId] of ids.entries()) {
    await transaction.insert(productMedia).values({
      storeId: input.storeId,
      productId: input.productId,
      mediaObjectId: mediaId,
      sortOrder,
      isPrimary: sortOrder === 0,
      deletedAt: null,
    }).onConflictDoUpdate({
      target: [productMedia.productId, productMedia.mediaObjectId],
      set: {
        sortOrder,
        isPrimary: sortOrder === 0,
        deletedAt: null,
      },
    });
  }

  const media = orderedRecords.map((record, index) => {
    const url = orderedUrls[index];
    if (!record || !url) throw new ProductMediaValidationError();
    return {
      mediaId: record.id,
      path: record.objectKey,
      url,
    };
  });
  const inherited = !product.parentProductId
    ? []
    : await transaction.select({ objectKey: mediaObjects.objectKey })
        .from(productMedia)
        .innerJoin(mediaObjects, and(
          eq(mediaObjects.storeId, productMedia.storeId),
          eq(mediaObjects.id, productMedia.mediaObjectId),
        ))
        .where(and(
          eq(productMedia.storeId, input.storeId),
          eq(productMedia.productId, product.parentProductId),
          isNull(productMedia.deletedAt),
          productMediaEligibilitySql(mediaObjects, {
            storeId: input.storeId,
            targetIds: [product.parentProductId],
            publicMedia: input.publicMedia,
          }),
        ))
        .orderBy(asc(productMedia.sortOrder));
  const storedExternalImageUrls = externalProductImageUrls(
    input.imageUrls,
    input.publicMedia,
  );
  const compatibilityMediaUrls = media.length > 0
    ? media.map((image) => image.url)
    : inherited.map((record) => getPublicMediaUrl(
      record.objectKey,
      input.publicMedia,
    ));
  const imageUrls = [
    ...storedExternalImageUrls,
    ...compatibilityMediaUrls,
  ];
  await transaction.update(products).set({
    imageUrls: storedExternalImageUrls,
    imageUpdatedAt: changedAt,
    updatedAt: changedAt,
  }).where(and(
    eq(products.storeId, input.storeId),
    eq(products.id, input.productId),
  ));

  if (
    product.isVariantParent
    && !sameOrderedUrls(product.imageUrls, storedExternalImageUrls)
  ) {
    const children = await transaction.select({
      id: products.id,
      imageUrls: products.imageUrls,
    }).from(products).where(and(
      eq(products.storeId, input.storeId),
      eq(products.parentProductId, input.productId),
    )).for("update");
    for (const child of children) {
      if (!sameOrderedUrls(child.imageUrls, product.imageUrls)) continue;
      await transaction.update(products).set({
        imageUrls: storedExternalImageUrls,
        imageUpdatedAt: changedAt,
        updatedAt: changedAt,
      }).where(and(
        eq(products.storeId, input.storeId),
        eq(products.id, child.id),
        eq(products.parentProductId, input.productId),
      ));
    }
  }

  const selectedIds = new Set(ids);
  for (const { mediaId } of existing) {
    if (selectedIds.has(mediaId)) continue;
    await softDeleteMediaIfUnreferencedInTransaction(transaction, {
      storeId: input.storeId,
      mediaId,
      deletedAt: changedAt,
      expectedPurpose: "product-image",
      expectedTargetId: input.productId,
    });
  }

  return {
    imageUrls,
    externalImageUrls: storedExternalImageUrls,
    media,
  };
}
