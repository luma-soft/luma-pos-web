"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Plus, Trash2 } from "lucide-react";
import { RowPreviewModal } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";

type ConcreteServiceType = "camera" | "electrical" | "plumbing";
type RowValue = Record<string, string | number | boolean | undefined>;

const typeLabel: Record<ConcreteServiceType, string> = {
  camera: "Camera",
  electrical: "Điện",
  plumbing: "Nước",
};

const safetyDefaults = [
  { key: "ppe", label: "Đã kiểm tra bảo hộ cá nhân", completed: false },
  { key: "isolation", label: "Đã cô lập nguồn / khu vực thi công", completed: false },
  { key: "site_clearance", label: "Khu vực làm việc an toàn và thông thoáng", completed: false },
];

export function TradeRecordEditor({
  jobId,
  serviceType,
  initial,
}: {
  jobId: string;
  serviceType: ConcreteServiceType;
  initial: unknown;
}) {
  const router = useRouter();
  const source = useMemo(() => asRecord(initial), [initial]);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [note, setNote] = useState(stringValue(source.note));
  const [safety, setSafety] = useState(() => {
    const rows = recordRows(source.safety);
    return rows.length ? rows.map((row, index) => ({
      key: stringValue(row.key) || `safety_${index + 1}`,
      label: stringValue(row.label) || `Mục an toàn ${index + 1}`,
      completed: row.completed === true,
    })) : safetyDefaults;
  });
  const [measurements, setMeasurements] = useState<RowValue[]>(() => recordRows(source.measurements));
  const [topology, setTopology] = useState<RowValue[]>(() => recordRows(source.topology));
  const [circuits, setCircuits] = useState<RowValue[]>(() => recordRows(source.circuits));
  const [zones, setZones] = useState<RowValue[]>(() => recordRows(source.zones));
  const [lotoReference, setLotoReference] = useState(stringValue(source.lotoReference));
  const [singleLineDiagramUrl, setSingleLineDiagramUrl] = useState(stringValue(source.singleLineDiagramUrl));
  const [routePlanUrl, setRoutePlanUrl] = useState(stringValue(source.routePlanUrl));

  async function save() {
    if (busy) return;
    setBusy(true);
    setMessage("");
    try {
      const common = {
        serviceType,
        safety,
        measurements: measurements
          .filter((row) => stringValue(row.label) && stringValue(row.value))
          .map((row, index) => ({
            key: stringValue(row.key) || `measurement_${index + 1}`,
            label: stringValue(row.label),
            value: stringValue(row.value),
            unit: stringValue(row.unit) || undefined,
            passed: row.passed === true,
          })),
        evidence: Array.isArray(source.evidence) ? source.evidence : [],
        documents: Array.isArray(source.documents) ? source.documents : [],
        note,
      };
      const data = serviceType === "camera"
        ? {
            ...common,
            topology: topology
              .filter((row) => stringValue(row.name))
              .map((row) => ({
                name: stringValue(row.name),
                kind: stringValue(row.kind) || "camera",
                location: stringValue(row.location),
              })),
          }
        : serviceType === "electrical"
          ? {
              ...common,
              circuits: circuits
                .filter((row) => stringValue(row.code))
                .map((row) => ({
                  code: stringValue(row.code),
                  description: stringValue(row.description),
                  breaker: stringValue(row.breaker),
                  cable: stringValue(row.cable),
                  loadWatts: optionalNumber(row.loadWatts),
                })),
              lotoReference,
              singleLineDiagramUrl,
            }
          : {
              ...common,
              zones: zones
                .filter((row) => stringValue(row.name))
                .map((row) => ({
                  name: stringValue(row.name),
                  pipeSpec: stringValue(row.pipeSpec),
                  isolationPoint: stringValue(row.isolationPoint),
                  pressureBar: optionalNumber(row.pressureBar),
                  durationMinutes: optionalNumber(row.durationMinutes),
                  pressureDropBar: optionalNumber(row.pressureDropBar),
                  passed: row.passed === true,
                })),
              routePlanUrl,
            };
      const response = await fetch(`/api/mobile/services/jobs/${jobId}/trade-record`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      });
      const payload = await response.json() as { ok: boolean; error?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error ?? "Không lưu được hồ sơ bộ môn");
      setMessage("Đã lưu hồ sơ bộ môn và ghi lịch sử thay đổi.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Không lưu được hồ sơ bộ môn");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}>
        <ClipboardCheck className="h-4 w-4" /> Cập nhật hồ sơ {typeLabel[serviceType]}
      </Button>
      <RowPreviewModal
        open={open}
        onClose={() => setOpen(false)}
        title={`Hồ sơ bộ môn ${typeLabel[serviceType]}`}
        subtitle="Checklist an toàn, phép đo, thông số kỹ thuật và chứng cứ được lưu theo lệnh việc."
        size="xl"
        footer={(
          <div className="flex items-center justify-between gap-3">
            <p role="status" className="text-xs text-slate-500">{message}</p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Đóng</Button>
              <Button onClick={() => void save()} disabled={busy} loading={busy}>Lưu hồ sơ</Button>
            </div>
          </div>
        )}
      >
        <div className="space-y-5">
          <EditorSection title="An toàn trước thi công">
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {safety.map((item, index) => (
                <button
                  key={item.key}
                  type="button"
                  aria-pressed={item.completed}
                  onClick={() => setSafety((rows) => rows.map((row, rowIndex) => rowIndex === index ? { ...row, completed: !row.completed } : row))}
                  className={cn(
                    "min-h-11 min-w-11 rounded-xl border px-3 py-2 text-left text-sm font-semibold",
                    item.completed ? "border-primary-300 bg-primary-50 text-primary-700" : "border-border hover:bg-surface-2",
                  )}
                >
                  {item.completed ? "Đã xác nhận · " : "Chưa xác nhận · "}{item.label}
                </button>
              ))}
            </div>
          </EditorSection>

          {serviceType === "camera" && (
            <EditorSection title="Sơ đồ thiết bị & topology" action={<AddButton onClick={() => setTopology((rows) => [...rows, { kind: "camera" }])} />}>
              <DynamicRows rows={topology} onChange={setTopology} fields={[
                { key: "name", label: "Tên thiết bị" },
                { key: "kind", label: "Loại", options: ["camera", "nvr", "switch", "storage", "network", "other"] },
                { key: "location", label: "Vị trí" },
              ]} />
            </EditorSection>
          )}

          {serviceType === "electrical" && (
            <>
              <EditorSection title="Mạch điện & kiểm tra tải" action={<AddButton onClick={() => setCircuits((rows) => [...rows, {}])} />}>
                <DynamicRows rows={circuits} onChange={setCircuits} fields={[
                  { key: "code", label: "Mã mạch" },
                  { key: "description", label: "Mô tả" },
                  { key: "breaker", label: "CB / breaker" },
                  { key: "cable", label: "Tiết diện cáp" },
                  { key: "loadWatts", label: "Tải (W)", type: "number" },
                ]} />
              </EditorSection>
              <div className="grid gap-3 sm:grid-cols-2">
                <LabeledInput label="Mã / biên bản LOTO" value={lotoReference} onChange={setLotoReference} />
                <LabeledInput label="URL sơ đồ một sợi" value={singleLineDiagramUrl} onChange={setSingleLineDiagramUrl} />
              </div>
            </>
          )}

          {serviceType === "plumbing" && (
            <>
              <EditorSection title="Khu vực & thử áp" action={<AddButton onClick={() => setZones((rows) => [...rows, {}])} />}>
                <DynamicRows rows={zones} onChange={setZones} fields={[
                  { key: "name", label: "Khu vực" },
                  { key: "pipeSpec", label: "Quy cách ống" },
                  { key: "isolationPoint", label: "Điểm khóa" },
                  { key: "pressureBar", label: "Áp suất (bar)", type: "number" },
                  { key: "durationMinutes", label: "Thời gian (phút)", type: "number" },
                  { key: "pressureDropBar", label: "Sụt áp (bar)", type: "number" },
                  { key: "passed", label: "Kết quả", options: ["true", "false"] },
                ]} />
              </EditorSection>
              <LabeledInput label="URL sơ đồ tuyến ống" value={routePlanUrl} onChange={setRoutePlanUrl} />
            </>
          )}

          <EditorSection title="Phép đo / kết quả kiểm tra" action={<AddButton onClick={() => setMeasurements((rows) => [...rows, {}])} />}>
            <DynamicRows rows={measurements} onChange={setMeasurements} fields={[
              { key: "label", label: "Chỉ tiêu" },
              { key: "value", label: "Giá trị" },
              { key: "unit", label: "Đơn vị" },
              { key: "passed", label: "Kết quả", options: ["true", "false"] },
            ]} />
          </EditorSection>

          <label className="block">
            <span className="mb-1 block text-xs font-semibold text-slate-600">Ghi chú kỹ thuật</span>
            <Textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} />
          </label>
        </div>
      </RowPreviewModal>
    </>
  );
}

function EditorSection({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section className="rounded-xl border border-border p-4"><header className="mb-3 flex items-center justify-between gap-3"><h3 className="font-semibold">{title}</h3>{action}</header>{children}</section>;
}

function AddButton({ onClick }: { onClick: () => void }) {
  return <Button variant="outline" size="sm" onClick={onClick}><Plus className="h-4 w-4" /> Thêm dòng</Button>;
}

function LabeledInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-600">{label}</span><Input value={value} onChange={(event) => onChange(event.target.value)} /></label>;
}

function DynamicRows({ rows, onChange, fields }: {
  rows: RowValue[];
  onChange: (rows: RowValue[]) => void;
  fields: Array<{ key: string; label: string; type?: string; options?: string[] }>;
}) {
  if (!rows.length) return <p className="rounded-lg bg-surface-2 px-3 py-4 text-sm text-slate-500">Chưa có dữ liệu. Chọn “Thêm dòng” để ghi nhận.</p>;
  return <div className="space-y-3">{rows.map((row, index) => <div key={index} className="grid gap-2 rounded-xl bg-surface-2 p-3 sm:grid-cols-2 lg:grid-cols-4">{fields.map((field) => <label key={field.key} className="block"><span className="mb-1 block text-[11px] font-semibold text-slate-500">{field.label}</span>{field.options ? <Select value={String(row[field.key] ?? "")} onValueChange={(value) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, [field.key]: value === "true" ? true : value === "false" ? false : value } : item))} options={field.options.map((value) => ({ value, label: value === "true" ? "Đạt" : value === "false" ? "Không đạt" : value }))} rootClassName="w-full" /> : <Input type={field.type ?? "text"} value={String(row[field.key] ?? "")} onChange={(event) => onChange(rows.map((item, itemIndex) => itemIndex === index ? { ...item, [field.key]: event.target.value } : item))} />}</label>)}<div className="flex items-end justify-end"><Button variant="outline" size="sm" aria-label={`Xóa dòng ${index + 1}`} onClick={() => onChange(rows.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="h-4 w-4" /></Button></div></div>)}</div>;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function recordRows(value: unknown): RowValue[] {
  return Array.isArray(value) ? value.map(asRecord).map((row) => ({ ...row } as RowValue)) : [];
}

function stringValue(value: unknown) {
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function optionalNumber(value: unknown) {
  const text = stringValue(value).trim();
  return text ? Number(text) : undefined;
}
