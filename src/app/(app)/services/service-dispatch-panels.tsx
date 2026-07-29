import Link from "next/link";
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

function selectClass() {
  return "min-h-10 rounded-lg border border-border bg-surface px-3 text-sm";
}

export function ServiceDispatchPanel({
  data,
  technicians,
  params,
}: {
  data: DispatchData;
  technicians: Technician[];
  params: Record<string, string | undefined>;
}) {
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
          <select name="scope" defaultValue={params.scope ?? "week"} className={selectClass()}>
            <option value="today">Hôm nay</option>
            <option value="week">7 ngày</option>
          </select>
          <select name="status" defaultValue={params.status ?? ""} className={selectClass()}>
            <option value="">Tất cả trạng thái</option>
            <option value="new,scheduled">Mới / đã lên lịch</option>
            <option value="in_progress">Đang làm</option>
            <option value="waiting_materials,waiting_customer">Đang chờ</option>
            <option value="completed">Hoàn tất</option>
          </select>
          <select name="priority" defaultValue={params.priority ?? ""} className={selectClass()}>
            <option value="">Tất cả ưu tiên</option>
            <option value="urgent">Khẩn</option>
            <option value="high">Cao</option>
            <option value="normal">Bình thường</option>
            <option value="low">Thấp</option>
          </select>
          <select name="technicianId" defaultValue={params.technicianId ?? ""} className={selectClass()}>
            <option value="">Tất cả kỹ thuật viên</option>
            {technicians.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input type="checkbox" name="unassigned" value="true" defaultChecked={params.unassigned === "true"} />
            Chưa phân công
          </label>
          <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input type="checkbox" name="slaOverdue" value="true" defaultChecked={params.slaOverdue === "true"} />
            Quá hạn SLA
          </label>
          <label className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-border px-3 text-sm">
            <input type="checkbox" name="maintenanceOverdue" value="true" defaultChecked={params.maintenanceOverdue === "true"} />
            Trễ bảo trì
          </label>
          <button className="min-h-10 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white" type="submit">
            Lọc lịch
          </button>
        </form>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
        {[...days.entries()].map(([day, rows]) => (
          <Section key={day} title={day === "unscheduled" ? "Chưa xếp lịch" : day} collapsible={false}>
            <div className="space-y-2">
              {rows.map((row) => (
                <article key={row.id} className="rounded-lg border border-border-soft p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-mono text-xs font-semibold">{row.code}</p>
                      <p className="mt-1 text-sm font-semibold">{row.title}</p>
                      <p className="mt-1 text-xs text-slate-500">{row.projectName} · {row.assignedToName ?? "Chưa phân công"}</p>
                    </div>
                    <span className="rounded-full bg-surface-2 px-2 py-1 text-xs">{row.status}</span>
                  </div>
                  <p className="mt-2 text-xs text-slate-500">{row.scheduledAt ? formatDate(row.scheduledAt) : "—"}</p>
                  {(row.slaOverdue || row.maintenanceOverdue) && (
                    <div className="mt-2 flex gap-2 text-xs font-semibold text-red-600">
                      {row.slaOverdue && <span>Quá hạn SLA</span>}
                      {row.maintenanceOverdue && <span>Trễ bảo trì</span>}
                    </div>
                  )}
                </article>
              ))}
            </div>
          </Section>
        ))}
      </div>
      {data.rows.length === 0 && <Section collapsible={false}><Text variant="muted" size="sm" text="Không có lệnh việc phù hợp." /></Section>}
      <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.limit} pageSizes={SERVICE_PAGE_SIZES} unitLabel="lệnh việc" />
    </div>
  );
}

export function ServiceReportPanel({ data }: { data: ReportData }) {
  const { metrics } = data;
  const cards = [
    ["Tổng lệnh", metrics.total],
    ["Hoàn tất", `${metrics.completed} (${metrics.completionRate}%)`],
    ["Quá hạn SLA", metrics.overdueSla],
    ["Trễ bảo trì", metrics.overdueMaintenance],
    ["Thời gian làm", `${metrics.workMinutes} phút`],
    ["Lượt làm việc", metrics.visits],
    [
      "Hoàn tất lần đầu",
      metrics.firstTimeCompletion.available
        ? `${metrics.firstTimeCompletion.numerator}/${metrics.firstTimeCompletion.denominator} (${metrics.firstTimeCompletion.rate}%)`
        : "Chưa đủ dữ liệu",
    ],
  ] as const;
  return (
    <div className="space-y-4">
      <Section collapsible={false}>
        <form className="flex flex-wrap items-end gap-2" method="get">
          <input type="hidden" name="tab" value="reporting" />
          <label className="text-xs text-slate-500">Từ ngày<input className={`${selectClass()} ml-2`} type="date" name="from" /></label>
          <label className="text-xs text-slate-500">Đến trước ngày<input className={`${selectClass()} ml-2`} type="date" name="to" /></label>
          <button className="min-h-10 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white" type="submit">Xem báo cáo</button>
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
      <Section title="Chi tiết lệnh việc" collapsible={false}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px] text-sm">
            <thead><tr className="border-b border-border text-left text-xs text-slate-500">
              <th className="p-2">Mã</th><th className="p-2">Công trình</th><th className="p-2">Phụ trách</th>
              <th className="p-2">Trạng thái</th><th className="p-2 text-right">Lượt</th><th className="p-2 text-right">Phút</th>
            </tr></thead>
            <tbody>{data.rows.map((row) => (
              <tr key={row.id} className="border-b border-border-soft">
                <td className="p-2 font-mono text-xs">{row.code}</td>
                <td className="p-2">{row.projectName}<div className="text-xs text-slate-500">{row.title}</div></td>
                <td className="p-2">{row.assignedToName ?? "Chưa phân công"}</td>
                <td className="p-2">{row.status}</td>
                <td className="p-2 text-right tabular-nums">{row.visitCount}</td>
                <td className="p-2 text-right tabular-nums">{row.workMinutes}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-slate-500">
          Hoàn tất lần đầu = lệnh hoàn tất có đúng một lượt làm việc / lệnh hoàn tất có ít nhất một lượt làm việc.
        </p>
      </Section>
      <Pagination page={data.page} pageCount={data.pageCount} total={data.total} pageSize={data.limit} pageSizes={SERVICE_PAGE_SIZES} unitLabel="lệnh việc" />
      <Link href="/services?tab=reporting" className="text-sm font-semibold text-primary-600">Đặt lại khoảng báo cáo</Link>
    </div>
  );
}
