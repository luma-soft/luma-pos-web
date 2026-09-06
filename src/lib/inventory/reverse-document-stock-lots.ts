import { and, asc, eq, sql } from "drizzle-orm";
import { stockLotMovements, stockLots } from "@/db/schema";
import type { InventoryTransaction } from "@/lib/inventory/stock-lot-service";

/** Caller must lock the document before reversing its currently outstanding lot consumption. */
export async function reverseDocumentStockLots(
  tx: InventoryTransaction,
  input: { storeId: string; refType: string; refId: string; createdBy: string | null },
) {
  const movements = await tx.select({ lotId: stockLots.id, quantity: stockLotMovements.quantity })
    .from(stockLotMovements)
    .innerJoin(stockLots, eq(stockLots.id, stockLotMovements.stockLotId))
    .where(and(
      eq(stockLots.storeId, input.storeId),
      eq(stockLotMovements.storeId, input.storeId),
      eq(stockLotMovements.refType, input.refType),
      eq(stockLotMovements.refId, input.refId),
    ))
    .orderBy(asc(stockLots.id))
    .for("update");
  const netByLot = new Map<string, number>();
  for (const movement of movements) {
    netByLot.set(movement.lotId, (netByLot.get(movement.lotId) ?? 0) + Math.round(Number(movement.quantity) * 10000));
  }
  for (const [lotId, net] of netByLot) {
    if (net >= 0) continue;
    const quantity = (-net / 10000).toFixed(4);
    await tx.update(stockLots).set({ availableQuantity: sql`${stockLots.availableQuantity} + ${quantity}` })
      .where(and(eq(stockLots.storeId, input.storeId), eq(stockLots.id, lotId)));
    // The same reference nets prior reversals out on subsequent edits/deletion.
    await tx.insert(stockLotMovements).values({
      storeId: input.storeId, stockLotId: lotId, quantity, refType: input.refType, refId: input.refId, createdBy: input.createdBy,
    });
  }
}
