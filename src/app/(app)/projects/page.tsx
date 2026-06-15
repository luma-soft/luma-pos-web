import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { asc, desc, eq, sql } from "drizzle-orm";
import { Building2 } from "lucide-react";
import { db } from "@/db";
import { customers, orders, projects } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency } from "@/lib/utils";
import { ProjectQuickCreate, ProjectToggle } from "./project-widgets";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const t = await getTranslations();

  const [rows, customerOptions] = await Promise.all([
    db
      .select({
        id: projects.id,
        name: projects.name,
        address: projects.address,
        status: projects.status,
        customerName: customers.name,
        orderCount: sql<number>`(select count(*) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} != 'cancelled')::int`,
        totalValue: sql<string>`coalesce((select sum(${orders.total}) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} not in ('cancelled','quote','merged')), 0)`,
        remaining: sql<string>`coalesce((select sum(${orders.total} - ${orders.amountPaid}) from ${orders} where ${orders.projectId} = ${projects.id} and ${orders.status} = 'completed'), 0)`,
      })
      .from(projects)
      .leftJoin(customers, eq(projects.customerId, customers.id))
      .orderBy(desc(projects.createdAt)),
    db.select({ id: customers.id, name: customers.name }).from(customers).where(eq(customers.isActive, true)).orderBy(asc(customers.name)).limit(300),
  ]);

  return (
    <div className="p-6">
      <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-5 min-h-[58px] px-6 py-2.5 bg-surface border-b border-border flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-baseline gap-3">
          <h1 className="text-[17px] font-bold">{t("projects.title")}</h1>
          <span className="text-sm text-slate-500">{t("projects.total", { total: rows.length })}</span>
        </div>
        <ProjectQuickCreate customers={customerOptions} />
      </div>

      {rows.length === 0 ? (
        <div className="bg-surface border border-dashed border-border rounded-card p-12 text-center text-slate-400">
          <Building2 className="w-10 h-10 mx-auto mb-3 opacity-60" />
          <p className="font-medium">{t("projects.empty")}</p>
          <p className="text-sm mt-1">{t("projects.emptyHint")}</p>
        </div>
      ) : (
        <>
        {/* mobile: card list */}
        <div className="lg:hidden space-y-2">
          {rows.map((p) => {
            const remaining = Number(p.remaining);
            return (
              <div key={p.id} className={cn("bg-surface border border-border rounded-card p-3", p.status === "done" && "opacity-60")}>
                <div className="flex items-start justify-between gap-2">
                  <Link href={`${Routes.Orders}?q=${encodeURIComponent(p.name)}`} className="min-w-0">
                    <div className="font-medium truncate">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.customerName ?? "—"} · {p.orderCount} {t("projects.cols.orders")}</div>
                  </Link>
                  <ProjectToggle id={p.id} status={p.status} />
                </div>
                <div className="flex items-center justify-between mt-2 text-sm">
                  <span className="font-semibold tabular-nums">{formatCurrency(Number(p.totalValue))}</span>
                  {remaining > 0 && <span className="text-er font-semibold tabular-nums">{t("orders.cols.remaining")}: {formatCurrency(remaining)}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {/* desktop: bảng */}
        <div className="hidden lg:block bg-surface border border-border rounded-card overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                <th className="px-4 py-3 font-semibold">{t("projects.cols.name")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.customer")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("projects.cols.orders")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("projects.cols.value")}</th>
                <th className="px-4 py-3 font-semibold text-right">{t("orders.cols.remaining")}</th>
                <th className="px-4 py-3 font-semibold">{t("orders.cols.status")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {rows.map((p) => {
                const remaining = Number(p.remaining);
                return (
                  <tr key={p.id} className={cn("hover:bg-surface-2", p.status === "done" && "opacity-60")}>
                    <td className="px-4 py-3">
                      <Link href={`${Routes.Orders}?q=${encodeURIComponent(p.name)}`} className="font-medium text-primary-600 hover:underline">{p.name}</Link>
                      {p.address && <div className="text-xs text-slate-400">{p.address}</div>}
                    </td>
                    <td className="px-4 py-3">{p.customerName ?? "—"}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{p.orderCount}</td>
                    <td className="px-4 py-3 text-right tabular-nums font-medium">{formatCurrency(Number(p.totalValue))}</td>
                    <td className={cn("px-4 py-3 text-right tabular-nums", remaining > 0 ? "text-er font-semibold" : "text-slate-400")}>
                      {remaining > 0 ? formatCurrency(remaining) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn(
                        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium",
                        p.status === "active"
                          ? "bg-in-soft text-in"
                          : "bg-surface-2 text-slate-500"
                      )}>
                        {t(`projects.status.${p.status}` as never)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right"><ProjectToggle id={p.id} status={p.status} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        </>
      )}
    </div>
  );
}
