import { Suspense } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { and, count, desc, eq, or } from "drizzle-orm";
import { ClipboardList, Search } from "lucide-react";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { accentInsensitiveLike } from "@/lib/search";
import { TableSkeleton } from "@/components/table-skeleton";
import { getOrder } from "@/lib/data/orders";
import { OrderDetailPanel } from "../../orders/[id]/order-detail-panel";
import { BookingsTable } from "./bookings-table";

type SP = Record<string, string | undefined>;

export async function BookingsTab({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;

  return (
    <>
      <form className="flex items-center gap-3 mb-4" action={Routes.Sales}>
        <input type="hidden" name="tab" value="bookings" />
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input type="text" name="q" defaultValue={params.q ?? ""} placeholder={t("orders.searchPlaceholder")} className="w-full rounded-lg border border-border bg-surface py-2 pl-9 pr-3 text-sm" />
        </div>
        <button type="submit" className="rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">{t("common.search")}</button>
        <Link href={Routes.POS} className="ml-auto inline-flex shrink-0 items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-medium text-white transition hover:brightness-110 active:scale-[0.98]">
          <ClipboardList className="h-4 w-4" />
          {t("bookings.createViaPos")}
        </Link>
      </form>

      <Suspense fallback={<TableSkeleton cols={6} rows={10} />}>
        <BookingsContent searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function BookingsContent({ searchParams }: { searchParams: SP }) {
  const t = await getTranslations();
  const params = searchParams;
  const page = Number(params.page) || 1;
  const q = params.q?.trim();

  const where = q
    ? and(eq(orders.status, "confirmed"), or(accentInsensitiveLike(orders.code, q), accentInsensitiveLike(customers.name, q), accentInsensitiveLike(orders.projectName, q)))
    : and(eq(orders.status, "confirmed"));
  const [rows, [{ total }]] = await Promise.all([
    db.select({
      id: orders.id,
      code: orders.code,
      total: orders.total,
      projectName: orders.projectName,
      deliveryDate: orders.deliveryDate,
      createdAt: orders.createdAt,
      customerName: customers.name,
    })
      .from(orders)
      .leftJoin(customers, eq(orders.customerId, customers.id))
      .where(where)
      .orderBy(desc(orders.createdAt))
      .limit(20)
      .offset((page - 1) * 20),
    db.select({ total: count() }).from(orders).leftJoin(customers, eq(orders.customerId, customers.id)).where(where),
  ]);
  const expandedId = params.expandedBooking ?? null;
  const expandedBooking = expandedId ? await getOrder(expandedId).catch(() => null) : null;

  return (
    <>
      <div className="mb-2">
        <span className="text-sm text-slate-500">{t("bookings.total", { total })}</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface p-12 text-center text-slate-400">
          <ClipboardList className="mx-auto mb-3 h-10 w-10 opacity-60" />
          <p className="font-medium">{t("bookings.empty")}</p>
          <p className="mt-1 text-sm">{t("bookings.emptyHint")}</p>
        </div>
      ) : (
        <BookingsTable rows={rows} expandedId={expandedBooking?.id ?? expandedId} expandedContent={expandedBooking ? <OrderDetailPanel order={expandedBooking} compact /> : null} />
      )}
    </>
  );
}
