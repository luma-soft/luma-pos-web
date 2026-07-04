import { getMobilePosData } from "@/lib/data/pos";
import { getMobileProducts } from "@/lib/data/products";
import { requireMobileSalesAccess } from "@/lib/mobile/auth";
import { mobileGate, mobileOk } from "@/lib/mobile/response";

export async function GET() {
  const gate = await requireMobileSalesAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  try {
    return mobileOk(await getMobilePosData());
  } catch {
    const productPage = await getMobileProducts({ pageSize: 30 });
    return mobileOk({
      warehouse: null,
      products: productPage.rows,
      customers: [],
      promoByProduct: {},
      projects: [],
      priceBooks: [],
      defaultBankAccount: null,
    });
  }
}
