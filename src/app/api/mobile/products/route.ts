import { createProduct } from "@/lib/actions/products";
import {
  getMobileProductOptions,
  getMobileProducts,
} from "@/lib/data/products";
import type { ProductListView, ProductStatusFilter } from "@/lib/data/products";
import { parseProductListSort } from "@/lib/inventory/product-list-policy";
import { canViewPurchasePrices } from "@/lib/pricing/system-price-books";
import {
  requireMobileStockAccess,
  requireMobileStockReadAccess,
} from "@/lib/mobile/auth";
import {
  mobileAction,
  mobileGate,
  mobileOk,
  numberParam,
  readJson,
  searchParam,
} from "@/lib/mobile/response";

export async function GET(request: Request) {
  const gate = await requireMobileStockReadAccess();
  if (!gate.ok) return mobileGate(gate)!;

  const [products, options] = await Promise.all([
    getMobileProducts(gate.storeId, {
      q: searchParam(request, "q"),
      categoryId: searchParam(request, "categoryId"),
      brandId: searchParam(request, "brandId"),
      supplierId: searchParam(request, "supplierId"),
      categoryIds: searchParam(request, "categoryIds")?.split(",").filter(Boolean),
      brandIds: searchParam(request, "brandIds")?.split(",").filter(Boolean),
      supplierIds: searchParam(request, "supplierIds")?.split(",").filter(Boolean),
      warehouseId: searchParam(request, "warehouseId"),
      stock: searchParam(request, "stock") as "instock" | "low" | "out" | undefined,
      sort: parseProductListSort(searchParam(request, "sort")),
      productKind: searchParam(request, "productKind") as "product" | "service" | "combo" | undefined,
      status: (searchParam(request, "status") ?? searchParam(request, "lifecycle")) as ProductStatusFilter | undefined,
      view: searchParam(request, "view") as ProductListView | undefined,
      groupRelated: searchParam(request, "variantContractVersion") === "2",
      updatedSince: searchParam(request, "updatedSince"),
      page: numberParam(request, "page", 1),
      pageSize: numberParam(request, "pageSize", 50),
    }),
    getMobileProductOptions(gate.storeId),
  ]);

  const includeNetPurchase = canViewPurchasePrices(gate.role);
  return mobileOk({ products: {
    ...products,
    rows: products.rows.map((row) => ({
      ...row,
      lastPurchaseNetPrice: includeNetPurchase ? row.lastPurchaseNetPrice : null,
      ...(row.variantGroup ? { variantGroup: { ...row.variantGroup, members: row.variantGroup.members.map((member) => ({
        ...member, lastPurchaseNetPrice: includeNetPurchase ? member.lastPurchaseNetPrice : null,
      })) } } : {}),
    })),
  }, options });
}

export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  const blocked = mobileGate(gate);
  if (blocked) return blocked;

  const body = await readJson(request);
  if (!body) return mobileAction({ ok: false, error: "errors.invalidData" });

  return mobileAction(await createProduct(body));
}
