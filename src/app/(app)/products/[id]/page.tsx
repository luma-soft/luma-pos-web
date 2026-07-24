import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getProductListItem } from "@/lib/data/products";
import { ProductDetailView } from "../../inventory/tabs/products-table";
import { ProductEditorModal } from "../../inventory/tabs/products";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}

export default async function ProductDetailPage({ params, searchParams }: Props) {
  const { id } = await params;
  const query = await searchParams;
  const product = await getProductListItem(id);
  if (!product) notFound();

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href={`${Routes.Inventory}?tab=products`}
          className="grid h-9 w-9 place-items-center rounded-lg border border-border bg-surface text-slate-500 transition hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-100"
          aria-label="Quay lại danh sách sản phẩm"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-bold text-slate-900 dark:text-slate-100">{product.name}</h1>
          <p className="truncate text-sm text-slate-400">{product.sku}</p>
        </div>
      </div>
      <ProductDetailView product={product} surface="page" />
      {query.edit === "1" && (
        <ProductEditorModal
          searchParams={{ productModal: "edit", productId: id }}
          closeHrefOverride={Routes.productDetail(id)}
        />
      )}
    </div>
  );
}
