import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { Routes } from "@/lib/routes";
import { formatCurrency, formatDate } from "@/lib/utils";
import { getProjectDetail } from "@/lib/data/projects";
import { OrderStatusBadge, PaymentStatusBadge } from "../../orders/status-badges";

export default async function ProjectDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const detail = await getProjectDetail(id);
  if (!detail) notFound();
  const { project, orders } = detail;

  return (
    <div className="p-4 sm:p-6 max-w-6xl">
      <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 mb-5 min-h-[58px] px-4 sm:px-6 py-2.5 bg-surface border-b border-border flex items-center gap-3">
        <Link href={`${Routes.Partners}?tab=projects`} className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800">
          <ArrowLeft className="w-4 h-4" />
        </Link>
        <div className="min-w-0">
          <h1 className="truncate text-[17px] font-bold">{project.name}</h1>
          <p className="text-xs text-slate-500">{project.customerName ?? t("projects.noCustomer")}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4 mb-5">
        <Metric label={t("projects.cols.orders")} value={String(project.orderCount)} />
        <Metric label={t("projects.cols.value")} value={formatCurrency(Number(project.totalValue))} />
        <Metric label={t("orders.cols.remaining")} value={formatCurrency(Number(project.remaining))} danger={Number(project.remaining) > 0} />
        <Metric label={t("orders.cols.status")} value={t(`projects.status.${project.status}` as never)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <div className="bg-surface border border-border rounded-card p-4 text-sm space-y-3">
          <Info label={t("projects.cols.name")} value={project.name} />
          <Info label={t("orders.cols.customer")} value={project.customerName ?? "—"} />
          <Info label={t("customers.fields.address")} value={project.address ?? "—"} />
          <Info label={t("customers.fields.note")} value={project.note ?? "—"} />
          <Info label={t("orders.cols.date")} value={formatDate(project.createdAt)} />
        </div>

        <div className="bg-surface border border-border rounded-card overflow-x-auto">
          <div className="px-4 py-3 border-b border-border font-semibold text-sm">{t("projects.relatedOrders")}</div>
          {orders.length === 0 ? (
            <p className="px-4 py-8 text-sm text-slate-400 text-center">{t("orders.empty")}</p>
          ) : (
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="bg-canvas text-left text-xs uppercase text-slate-500">
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.code")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.date")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.customer")}</th>
                  <th className="px-4 py-2.5 font-semibold">{t("orders.cols.status")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.total")}</th>
                  <th className="px-4 py-2.5 font-semibold text-right">{t("orders.cols.remaining")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border-soft">
                {orders.map((order) => {
                  const remaining = Number(order.total) - Number(order.amountPaid);
                  return (
                    <tr key={order.id}>
                      <td className="px-4 py-3"><Link href={Routes.order(order.id)} className="font-semibold text-primary-600 hover:underline">{order.code}</Link></td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(order.createdAt)}</td>
                      <td className="px-4 py-3">{order.customerName ?? t("orders.walkIn")}</td>
                      <td className="px-4 py-3"><div className="flex flex-wrap gap-1.5"><OrderStatusBadge status={order.status} /><PaymentStatusBadge status={order.paymentStatus} /></div></td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold">{formatCurrency(Number(order.total))}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-er">{remaining > 0 ? formatCurrency(remaining) : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="bg-surface border border-border rounded-card p-4">
      <div className="text-xs font-medium text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-bold tabular-nums ${danger ? "text-er" : ""}`}>{value}</div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-border-soft pb-2 last:border-b-0">
      <span className="text-slate-500">{label}</span>
      <span className="text-right font-medium">{value}</span>
    </div>
  );
}
