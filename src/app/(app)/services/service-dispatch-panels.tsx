import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Pagination } from "@/components/pagination";
import { Section } from "@/components/ui/section";
import { Text } from "@/components/ui/text";
import type {
  getServiceDispatchPage,
  getServiceManagerReport,
} from "@/lib/services/dispatch-reporting";
import { formatDate } from "@/lib/utils";
import { SERVICE_PAGE_SIZES } from "@/lib/services/dispatch-reporting-domain";

type DispatchData = Awaited<ReturnType<typeof getServiceDispatchPage>>;
type ReportData = Awaited<ReturnType<typeof getServiceManagerReport>>;
type Technician = { id: string; name: string };

export async function ServiceDispatchPanel({
  data,
  technicians,
  params,
}: {
  data: DispatchData;
  technicians: Technician[];
  params: Record<string, string | undefined>;
}) {
  const [t, priorities] = await Promise.all([
    getTranslations("services.dispatch"),
    getTranslations("services.priorities"),
  ]);
  const days = data.rows.reduce((groups, row) => {
    const day = row.scheduledAt
      ? new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(row.scheduledAt)
      : "unscheduled";
    const rows = groups.get(day) ?? [];
    rows.push(row);
    groups.set(day, rows);
    return groups;
  }, new Map<string, DispatchData["rows"]>());
  return (
    <div className="space-y-4">
      <Section collapsible={false}>
        <form className="flex flex-wrap gap-2" method="get">
          <input type="hidden" name="tab" value="dispatch" />
          <select name="scope" defaultValue={params.scope ?? "week"} className="min-h-11 min-w-11 rounded-lg border border-border bg-surface px-3 text-sm">
            <option value="today">{t("today")}</option>
            <option value="week">{t("sevenDays")}</option>
          </select>
          <select name="status" defaultValue={params.status ?? ""} className="min-h-11 min-w-11 rounded-lg border border-border bg-surface px-3 text-sm">
            <option value="">{t("allStatuses")}</option>
            <option value="new,scheduled">{t("newScheduled")}</option>
            <option value="in_progress">{t("inProgress")}</option>
            <option value="waiting_materials,waiting_customer">{t("waiting")}</option>
            <option value="completed">{t("completed")}</option>
          </select>
          <select name="priority" defaultValue={params.priority ?? ""} className="min-h-11 min-w-11 rounded-lg border border-border bg-surface px-3 text-sm">
            <option value="">{t("allPriorities")}</option>
            <option value="urgent">{priorities("urgent")}</option>
            <option value="high">{priorities("high")}</option>
            <option value="normal">{priorities("normal")}</option>
            <option value="low">{priorities("low")}</option>
          </select>
          <select name="technicianId" defaultValue={params.technicianId ?? ""} className="min-h-11 min-w-11 rounded-lg border border-border bg-surface px-3 text-sm">
            <option value="">{t("allTechnicians")}</option>
            {technicians.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <label className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input type="checkbox" name="unassigned" value="true" defaultChecked={params.unassigned === "true"} />
            {t("unassigned")}
          </label>
          <label className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input type="checkbox" name="slaOverdue" value="true" defaultChecked={params.slaOverdue === "true"} />
            {t("slaOverdue")}
          </label>
          <label className="inline-flex min-h-11 min-w-11 items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input type="checkbox" name="maintenanceOverdue" value="true" defaultChecked={params.maintenanceOverdue === "true"} />
            {t("maintenanceOverdue")}
          </label>
          <button className="min-h-11 min-w-11 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white" type="submit">
            {t("filterSchedule")}
          </button>
        </form>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {[...days.entries()].map(([day, rows]) => (
          <Section key={day} title={day === "unscheduled" ? t("unscheduled") : day} collapsible={false}>
            <div className="space-y-2">
              {rows.map((row) => (
                <article key={row.id} className="rounded-lg border border-border-soft p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-semibold">{row.code}</p>
                      <p className="mt-1 text-sm font-semibold">{row.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.projectName} · {row.assignedToName ?? t("unassigned")}</p>
                    </div>
                    <span className="rounded-full bg-surface-2 px-2 py-1 text-xs">{row.status}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{row.scheduledAt ? formatDate(row.scheduledAt) : "—"}</p>
                  {(row.slaOverdue || row.maintenanceOverdue) && (
                    <div className="mt-2 flex gap-2 text-xs font-semibold text-red-600">
                      {row.slaOverdue && <span>{t("slaOverdue")}</span>}
                      {row.maintenanceOverdue && <span>{t("maintenanceOverdue")}</span>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </Section>
        ))}
      </div>
      {data.rows.length === 0 && <Section collapsible={false}><Text variant="muted" size="sm" text={t("noMatchingJobs")} /></Section>}
      <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.limit} pageSizes={SERVICE_PAGE_SIZES} unitLabel={t("workOrderUnit")} />
    </div>
  );
}

export async function ServiceReportPanel({ data }: { data: ReportData }) {
  const t = await getTranslations("services.dispatch");
  const { metrics } = data;
  const cards = [
    [t("totalJobs"), metrics.total],
    [t("completedJobs"), `${metrics.completed} (${metrics.completionRate}%)`],
    [t("slaOverdue"), metrics.overdueSla],
    [t("maintenanceOverdue"), metrics.overdueMaintenance],
    [t("workTime"), `${metrics.workMinutes} ${t("minutes")}`],
    [t("visits"), metrics.visits],
    [
      t("firstTimeCompletion"),
      metrics.firstTimeCompletion.available
        ? `${metrics.firstTimeCompletion.numerator}/${metrics.firstTimeCompletion.denominator} (${metrics.firstTimeCompletion.rate}%)`
        : t("insufficientData"),
    ],
  ] as const;
  return (
    <div className="space-y-4">
      <Section collapsible={false}>
        <form className="flex flex-wrap items-end gap-2" method="get">
          <input type="hidden" name="tab" value="reporting" />
          <label className="text-xs text-slate-500">{t("fromDate")}<input className="ml-2 min-h-11 min-w-11 rounded-lg border border-border bg-surface px-3 text-sm" type="date" name="from" /></label>
          <label className="text-xs text-slate-500">{t("beforeDate")}<input className="ml-2 min-h-11 min-w-11 rounded-lg border border-border bg-surface px-3 text-sm" type="date" name="to" /></label>
          <button className="min-h-11 min-w-11 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white" type="submit">{t("viewReport")}</button>
        </form>
      </Section>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {cards.map(([label, value]) => (
          <Section key={label} collapsible={false}>
            <p className="text-xs text-slate-500">{label}</p>
            <p className="mt-1 text-xl font-bold tabular-nums">{value}</p>
          </Section>
        ))}
      </div>
      <Section title={t("details")} collapsible={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-slate-500">
              <th className="p-2">{t("code")}</th><th className="p-2">{t("project")}</th><th className="p-2">{t("assignee")}</th>
              <th className="p-2">{t("status")}</th><th className="p-2 text-right">{t("visitCount")}</th><th className="p-2 text-right">{t("minutesShort")}</th>
            </tr></thead>
            <tbody>{data.rows.map((row) => (
              <tr key={row.id} className="border-b border-border-soft">
                <td className="p-2 font-mono text-xs">{row.code}</td>
                <td className="p-2">{row.projectName}<div className="text-xs text-slate-500">{row.title}</div></td>
                <td className="p-2">{row.assignedToName ?? t("unassigned")}</td>
                <td className="p-2">{row.status}</td>
                <td className="p-2 text-right tabular-nums">{row.visitCount}</td>
                <td className="p-2 text-right tabular-nums">{row.workMinutes}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          {t("firstTimeCompletionHint")}
        </p>
      </Section>
      <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.limit} pageSizes={SERVICE_PAGE_SIZES} unitLabel={t("workOrderUnit")} />
      <Link href="/services?tab=reporting" className="inline-flex min-h-11 min-w-11 items-center text-sm font-semibold text-primary-600">{t("resetReportRange")}</Link>
    </div>
  );
}
