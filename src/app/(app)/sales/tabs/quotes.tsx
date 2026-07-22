import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { and, asc, count, desc, eq, or } from "drizzle-orm";
import { FileSpreadsheet, Search } from "lucide-react";
import { db } from "@/db";
import { categories, customers, orders, products } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { accentInsensitiveLike } from "@/lib/search";
import { TableSkeleton } from "@/components/table-skeleton";
import { getOrder } from "@/lib/data/orders";
import { OrderDetailPanel } from "../../orders/[id]/order-detail-panel";
import { QuotesTable } from "./quotes-table";
import { CameraQuoteCreateButton } from "./camera-quote-create-button";

type SP = Record<string, string | undefined>;

export async function QuotesTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const cameraRows = await db.select({
    id: products.id,
    sku: products.sku,
    name: products.name,
    retailPrice: products.retailPrice,
    imageUrls: products.imageUrls,
    description: products.description,
  })
    .from(products)
    .innerJoin(categories, eq(products.categoryId, categories.id))
    .where(eq(categories.name, "Camera giám sát"))
    .orderBy(asc(products.name));

  return (
    <>
      <form className="flex items-center gap-3 mb-4" action={Routes.Sales}>
        <input type="hidden" name="tab" value="quotes" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("orders.searchPlaceholder")} className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-border bg-surface" />
        </div>
        <button type="submit" className="px-4 py-2 text-sm font-medium rounded-full bg-primary-600 hover:brightness-110 text-white transition active:scale-[0.98]">{t("common.search")}</button>
        <CameraQuoteCreateButton
          className="ml-auto shrink-0"
          cameras={cameraRows.map((camera) => ({
            id: camera.id,
            sku: camera.sku ?? "",
            name: camera.name,
            retailPrice: Number(camera.retailPrice),
            imageUrl: Array.isArray(camera.imageUrls) && typeof camera.imageUrls[0] === "string" ? camera.imageUrls[0] : null,
            description: camera.description,
          }))}
        />
      </form>

      <Suspense fallback={<TableSkeleton cols={6} rows={10} />}>
        <QuotesContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function QuotesContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const q = params.q?.trim();

  const where = q
    ? and(eq(orders.status, "quote"), or(accentInsensitiveLike(orders.code, q), accentInsensitiveLike(customers.name, q), accentInsensitiveLike(orders.projectName, q)))
    : and(eq(orders.status, "quote"));
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: orders.id, code: orders.code, total: orders.total, projectName: orders.projectName,
      createdAt: orders.createdAt, customerName: customers.name,
    })
      .from(orders).leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where).orderBy(desc(orders.createdAt)).limit(20).offset((page - 1) * 20),
    db.select({ total: count() }).from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).where(where),
  ]);
  const expandedId = params.expandedQuote ?? null;
  const expandedQuote = expandedId ? await getOrder(expandedId).catch(() => null) : null;

  return (
    <>
      <div className="mb-2">
        <span className="text-sm text-slate-500">{t("quotes.total", { total })}</span>
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <FileSpreadsheet className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("quotes.empty")}</p>
          <p className="text-sm mt-1">{t("quotes.emptyHint")}</p>
        </div>
      ) : (
        <QuotesTable rows={rows} expandedId={expandedQuote?.id ?? expandedId} expandedContent={expandedQuote ? <OrderDetailPanel order={expandedQuote} compact /> : null} />
      )}
    </>
  );
}
