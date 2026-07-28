import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { Routes } from "@/lib/routes";
import { getProductListItem } from "@/lib/data/products";
import { ProductDetailView } from "../../inventory/tabs/products-table";
import { ProductEditorModal } from "../../inventory/tabs/products";
import { productEditorCloseHref } from "@/lib/product-editor-navigation";

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
    <div className="space-y-3 bg-canvas pb-4 lg:space-y-4 lg:bg-transparent lg:pb-0">
      <div className="sticky top-0 z-20 flex items-center gap-3 border-b border-border bg-surface px-4 py-2.5 lg:static lg:border-0 lg:bg-transparent lg:px-0 lg:py-0">
        <Link
          href={`${Routes.Inventory}?tab=products`}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-surface-2 text-primary-700 transition hover:bg-primary-50 hover:text-primary-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 lg:h-9 lg:w-9 lg:rounded-lg lg:border lg:border-border lg:bg-surface lg:text-slate-500 lg:hover:bg-surface-2 lg:hover:text-slate-900 dark:text-primary-300 dark:hover:text-primary-200 lg:dark:text-slate-400 lg:dark:hover:text-slate-100"
          aria-label="Quay lại danh sách sản phẩm"
        >
          <ArrowLeft className="h-5 w-5 lg:h-4 lg:w-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="line-clamp-2 text-lg font-black leading-tight tracking-[-0.01em] text-slate-900 lg:truncate lg:text-xl lg:font-bold dark:text-slate-100">{product.name}</h1>
          <p className="mt-0.5 truncate font-mono text-[11px] font-medium text-slate-400">{product.sku}{product.barcode ? ` · ${product.barcode}` : ""}</p>
        </div>
      </div>
      <ProductDetailView product={product} surface="page" />
      {query.edit === "1" && (
        <ProductEditorModal
          searchParams={{ productModal: "edit", productId: id }}
          closeHrefOverride={productEditorCloseHref("page", id)}
          closeNavigation="replace"
        />
      )}
    </div>
  );
}
