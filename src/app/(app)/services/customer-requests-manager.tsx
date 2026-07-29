"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/input";

type RequestRow = {
  id: string;
  code: string;
  projectId: string;
  projectName: string;
  title: string;
  description: string | null;
  contactName: string;
  contactPhone: string | null;
  priority: string;
  status: string;
  submittedAt: Date | null;
  respondedAt: Date | null;
  resolvedAt: Date | null;
  responseDueAt: Date | null;
  resolutionDueAt: Date | null;
  linkedJobId: string | null;
  linkedJobCode: string | null;
  internalNote: string | null;
  attachmentCount: number;
  responseOverdue: boolean;
  resolutionOverdue: boolean;
  attachments: {
    id: string;
    requestId: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
  }[];
};

const statuses = ["new", "triaged", "scheduled", "in_progress", "resolved", "closed", "void"];

export function CustomerRequestsManager({
  rows,
  jobs,
}: {
  rows: RequestRow[];
  jobs: { id: string; projectId: string; code: string; title: string }[];
}) {
  const router = useRouter();
  const [selected, setSelected] = useState<RequestRow | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  async function update(id: string, body: Record<string, unknown>) {
    setBusy(true);
    setError("");
    const response = await fetch(`/api/mobile/services/customer-requests/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    setBusy(false);
    if (!response.ok) {
      setError("Không thể cập nhật yêu cầu. Kiểm tra trạng thái và công việc liên kết.");
      return;
    }
    setSelected(null);
    router.refresh();
  }

  async function openAttachment(requestId: string, attachmentId: string) {
    const response = await fetch(`/api/mobile/services/customer-requests/${requestId}/attachments/${attachmentId}`);
    const body = await response.json() as { data?: { url?: string } };
    if (response.ok && body.data?.url) window.open(body.data.url, "_blank", "noopener,noreferrer");
    else setError("Không thể mở tệp evidence.");
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-bold">Yêu cầu khách hàng & SLA</h2>
        <p className="text-sm text-slate-500">Triage, liên kết công việc và theo dõi hạn phản hồi/xử lý.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-border bg-surface">
        <table className="min-w-[980px] w-full text-sm">
          <thead className="bg-surface-2 text-left text-xs font-semibold text-slate-500">
            <tr>
              <th className="px-3 py-2">Mã</th><th className="px-3 py-2">Công trình</th>
              <th className="px-3 py-2">Yêu cầu</th><th className="px-3 py-2">Trạng thái</th>
              <th className="px-3 py-2">SLA phản hồi</th><th className="px-3 py-2">SLA xử lý</th>
              <th className="px-3 py-2">Công việc</th><th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border-soft">
                <td className="px-3 py-3 font-mono text-xs">{row.code}</td>
                <td className="px-3 py-3">{row.projectName}</td>
                <td className="max-w-64 px-3 py-3"><p className="truncate font-semibold">{row.title}</p><p className="text-xs text-slate-500">{row.contactName}</p></td>
                <td className="px-3 py-3">{row.status}</td>
                <td className={`px-3 py-3 ${row.responseOverdue ? "font-bold text-red-600" : ""}`}>
                  {row.respondedAt ? "Đã phản hồi" : row.responseDueAt ? new Date(row.responseDueAt).toLocaleString("vi-VN") : "Chưa cấu hình"}
                </td>
                <td className={`px-3 py-3 ${row.resolutionOverdue ? "font-bold text-red-600" : ""}`}>
                  {row.resolvedAt ? "Đã xử lý" : row.resolutionDueAt ? new Date(row.resolutionDueAt).toLocaleString("vi-VN") : "Chưa cấu hình"}
                </td>
                <td className="px-3 py-3">{row.linkedJobCode ?? "—"}</td>
                <td className="px-3 py-3 text-right"><Button size="sm" variant="outline" onClick={() => { setSelected(row); setNote(row.internalNote ?? ""); }}>Chi tiết</Button></td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-6 text-center text-sm text-slate-500">Chưa có yêu cầu.</p>}
      </div>
      {selected && (
        <div className="fixed inset-0 z-[90] grid place-items-center bg-slate-950/45 p-4" onMouseDown={() => setSelected(null)}>
          <div className="w-full max-w-2xl rounded-2xl bg-surface p-5 shadow-xl" onMouseDown={(event) => event.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <div><p className="font-mono text-xs text-slate-500">{selected.code}</p><h3 className="text-lg font-bold">{selected.title}</h3><p className="mt-1 text-sm text-slate-600">{selected.description}</p></div>
              <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>Đóng</Button>
            </div>
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-xs text-slate-500">Liên hệ</dt><dd className="font-semibold">{selected.contactName} · {selected.contactPhone ?? "—"}</dd></div>
              <div><dt className="text-xs text-slate-500">Evidence</dt><dd className="font-semibold">{selected.attachmentCount} tệp private</dd></div>
            </dl>
            {selected.attachments.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                {selected.attachments.map((attachment) => (
                  <Button key={attachment.id} size="sm" variant="outline" onClick={() => openAttachment(selected.id, attachment.id)}>
                    {attachment.fileName} · {Math.ceil(attachment.sizeBytes / 1024)} KB
                  </Button>
                ))}
              </div>
            )}
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold text-slate-500">Công việc liên kết
                <Select
                  className="mt-1 w-full"
                  value={selected.linkedJobId ?? ""}
                  onChange={(event) => update(selected.id, { linkedJobId: event.target.value || null })}
                  options={[
                    { value: "", label: "Chưa liên kết" },
                    ...jobs.filter((job) => job.projectId === selected.projectId).map((job) => ({ value: job.id, label: `${job.code} · ${job.title}` })),
                  ]}
                />
              </label>
              <label className="text-xs font-semibold text-slate-500">Trạng thái
                <Select
                  className="mt-1 w-full"
                  value={selected.status}
                  onChange={(event) => update(selected.id, { status: event.target.value })}
                  options={statuses.map((status) => ({ value: status, label: status }))}
                />
              </label>
            </div>
            <label className="mt-4 block text-xs font-semibold text-slate-500">Ghi chú nội bộ
              <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} className="mt-1" />
            </label>
            {error && <p className="mt-3 text-sm font-semibold text-red-600">{error}</p>}
            <div className="mt-4 flex justify-end"><Button disabled={busy} onClick={() => update(selected.id, { internalNote: note || null })}>{busy ? "Đang lưu…" : "Lưu ghi chú"}</Button></div>
          </div>
        </div>
      )}
    </div>
  );
}
