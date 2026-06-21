import { asc, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { products, promotions } from "@/db/schema";
import { createPromotion } from "@/lib/actions/extras";
import {
  requireMobileManager,
  requireMobileSalesAccess,
} from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileGate,
  mobileOk,
  readJson,
} from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const [rows, productOptions] = await Promise.all([
    db
      .select({
        id: promotions.id,
        name: promotions.name,
        tiers: promotions.tiers,
        isActive: promotions.isActive,
        startsAt: promotions.startsAt,
        endsAt: promotions.endsAt,
        productId: promotions.productId,
        productName: products.name,
        baseUnit: products.baseUnit,
      })
      .from(promotions)
      .innerJoin(products, eq(promotions.productId, products.id))
      .orderBy(desc(promotions.createdAt)),
    db
      .select({
        id: products.id,
        name: products.name,
        sku: products.sku,
        baseUnit: products.baseUnit,
      })
      .from(products)
      .where(eq(products.isActive, true))
      .orderBy(asc(products.name))
      .limit(500),
  ]);

  return mobileOk({ rows, productOptions });
}

export async function POST(request: Request) {
  const gate = await requireMobileManager();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body || typeof body !== "object") {
    return mobileAction({ ok: false, error: "errors.invalidData" });
  }
  return mobileAction(
    await createPromotion(body as Parameters<typeof createPromotion>[0]),
  );
}
