import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getOrder } from "@/lib/data/orders";
import { getPrintTemplatesForDoc } from "@/lib/print/template";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";
import { MergeOrderDetailPreview } from "./merge-order-detail-preview";

export interface MergeOrdersPageProps {
  searchParams: Promise<{ ids?: string | string[] }>;
}

type Presentation = "page" | "modal";
type LoadedOrder = NonNullable<Awaited<ReturnType<typeof getOrder>>>;

export async function MergeOrdersContent({
  searchParams,
  presentation = "page",
}: MergeOrdersPageProps & { presentation?: Presentation }) {
  const [params, t, context] = await Promise.all([
    searchParams,
    getTranslations(),
    requireStoreContext(),
  ]);
  const ids = [...new Set((Array.isArray(params.ids) ? params.ids : params.ids ? [params.ids] : []).filter(Boolean))].slice(0, 20);

  const [loadedOrders, printTemplates, issuedEInvoices] = await Promise.all([
    Promise.all(ids.map((id) => getOrder(context.storeId, id).catch(() => null))),
    getPrintTemplatesForDoc(context.storeId, "order"),
    ids.length
      ? db
          .select({ orderId: einvoices.orderId })
          .from(einvoices)
          .where(and(
            eq(einvoices.storeId, context.storeId),
            inArray(einvoices.orderId, ids),
            eq(einvoices.status, "issued"),
          ))
      : Promise.resolve([]),
  ]);

  const selectedOrders = loadedOrders.filter((order): order is LoadedOrder => order !== null);
  const eligibleOrders = selectedOrders.filter((order) => order.status === "completed" && order.customerId);
  const customerIds = new Set(eligibleOrders.map((order) => order.customerId));
  const sameCustomer = customerIds.size === 1;
  const hasReturns = selectedOrders.some((order) => order.returns.some((row) => row.status === "completed"));
  const hasEInvoice = issuedEInvoices.length > 0;
  const canMerge = eligibleOrders.length >= 2
    && sameCustomer
    && eligibleOrders.length === selectedOrders.length
    && ids.length === selectedOrders.length
    && !hasReturns
    && !hasEInvoice;

  const previewParams = new URLSearchParams();
  ids.forEach((id) => previewParams.append("ids", id));
  const printHref = "/orders/merge/preview?" + previewParams.toString();

  return (
    <div className={cn(presentation === "page" && "mx-auto max-w-6xl p-4 sm:p-6")}>
      {presentation === "page" && <h1 className="mb-5 text-2xl font-bold">{t("merge.title")}</h1>}
      {selectedOrders.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface p-10 text-center text-slate-400">
          <p>{t("merge.noneSelected")}</p>
          <Link href={`${Routes.Sales}?tab=orders`} className="mt-2 inline-flex min-h-11 min-w-11 items-center text-sm text-primary-600 hover:underline lg:min-h-0 lg:min-w-0">
            ← {t("orders.title")}
          </Link>
        </div>
      ) : (
        <MergeOrderDetailPreview
          selectedOrders={selectedOrders}
          eligibleOrders={eligibleOrders}
          ids={selectedOrders.map((order) => order.id)}
          printHref={printHref}
          printTemplates={printTemplates}
          canMerge={canMerge}
          sameCustomer={sameCustomer}
          hasReturns={hasReturns}
          hasEInvoice={hasEInvoice}
        />
      )}
    </div>
  );
}
