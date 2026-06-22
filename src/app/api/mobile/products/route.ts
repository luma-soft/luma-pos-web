import { createProduct } from "@/lib/actions/products";
import { getProductFormOptions, getProducts } from "@/lib/data/products";
import type { ProductListView, ProductStatusFilter } from "@/lib/data/products";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileGate,
  mobileOk,
  numberParam,
  readJson,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const [products, options] = await Promise.all([
    getProducts({
      q: searchParam(request, "q"),
      categoryId: searchParam(request, "categoryId"),
      status: searchParam(request, "status") as ProductStatusFilter | undefined,
      view: searchParam(request, "view") as ProductListView | undefined,
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 50),
    }),
    getProductFormOptions(),
  ]);

  return mobileOk({ products, options });
}

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  return mobileAction(await createProduct(body));
}
