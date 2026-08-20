import { and, asc, eq, inArray } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type * as schema from "@/db/schema";
import { productUnits } from "@/db/schema";

type ProductTransaction = Parameters<
  Parameters<NodePgDatabase<typeof schema>["transaction"]>[0]
>[0];

export type ProductUnitSyncValue = {
  id?: string;
  unitName: string;
  multiplier: number;
  barcode?: string;
  priceOverride?: number | null;
};

function sameNullableText(current: string | null, next: string | null) {
  return current === next;
}

function sameNullableNumber(
  current: string | null,
  next: number | null,
) {
  return current == null ? next == null : next != null && Number(current) === next;
}

export async function syncProductUnits(
  tx: ProductTransaction,
  input: {
    storeId: string;
    productId: string;
    units: ProductUnitSyncValue[];
  },
) {
  const validUnits = input.units.filter(
    (unit) => unit.unitName.trim() && unit.multiplier > 0,
  );
  const existing = await tx
    .select({
      id: productUnits.id,
      unitName: productUnits.unitName,
      multiplier: productUnits.multiplier,
      barcode: productUnits.barcode,
      priceOverride: productUnits.priceOverride,
      sortOrder: productUnits.sortOrder,
    })
    .from(productUnits)
    .where(
      and(
        eq(productUnits.storeId, input.storeId),
        eq(productUnits.productId, input.productId),
      ),
    )
    .orderBy(asc(productUnits.sortOrder), asc(productUnits.id));

  const existingById = new Map(existing.map((unit) => [unit.id, unit]));
  const remainingIds = new Set(existingById.keys());

  for (const [index, unit] of validUnits.entries()) {
    const unitName = unit.unitName.trim();
    const barcode = unit.barcode?.trim() || null;
    const priceOverride = unit.priceOverride ?? null;
    let current = unit.id ? existingById.get(unit.id) : undefined;

    if (unit.id && (!current || !remainingIds.has(unit.id))) {
      throw new Error("PRODUCT_UNIT_NOT_FOUND");
    }
    if (!current) {
      current = existing.find(
        (candidate) =>
          remainingIds.has(candidate.id) && candidate.unitName === unitName,
      );
    }

    if (!current) {
      await tx.insert(productUnits).values({
        storeId: input.storeId,
        productId: input.productId,
        unitName,
        multiplier: String(unit.multiplier),
        barcode,
        priceOverride:
          priceOverride != null ? String(priceOverride) : null,
        sortOrder: index,
      });
      continue;
    }

    remainingIds.delete(current.id);
    const unchanged =
      current.unitName === unitName &&
      Number(current.multiplier) === unit.multiplier &&
      sameNullableText(current.barcode, barcode) &&
      sameNullableNumber(current.priceOverride, priceOverride) &&
      (current.sortOrder ?? 0) === index;
    if (unchanged) continue;

    await tx
      .update(productUnits)
      .set({
        unitName,
        multiplier: String(unit.multiplier),
        barcode,
        priceOverride:
          priceOverride != null ? String(priceOverride) : null,
        sortOrder: index,
      })
      .where(
        and(
          eq(productUnits.storeId, input.storeId),
          eq(productUnits.productId, input.productId),
          eq(productUnits.id, current.id),
        ),
      );
  }

  const removedIds = [...remainingIds];
  if (removedIds.length > 0) {
    await tx
      .delete(productUnits)
      .where(
        and(
          eq(productUnits.storeId, input.storeId),
          eq(productUnits.productId, input.productId),
          inArray(productUnits.id, removedIds),
        ),
      );
  }
}
