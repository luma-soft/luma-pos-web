"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { DataTableShell, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import {
  createInstalledAsset,
  createServiceJob,
  createWarrantyClaim,
  transitionServiceJob,
  transitionWarrantyClaim,
  updateServiceChecklist,
} from "@/lib/actions/services";
import type {
  ServiceJobRow,
  ServiceProjectRow,
  WarrantyClaimRow,
} from "@/lib/data/services";
import { Routes } from "@/lib/routes";
import { cn, formatDate } from "@/lib/utils";
import type { ServiceChecklistItem, ServiceJobStatus, WarrantyClaimStatus } from "@/lib/services/domain";

type ProjectOption = { id: string; name: string; serviceType: string | null };
type AssigneeOption = { id: string; name: string };

export function ServiceProjectsTable({ rows }: { rows: ServiceProjectRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ServiceProjectRow>[] = [
    {
      key: "name",
      label: t("projects.cols.name"),
      required: true,
      render: (row) => <Link href={Routes.project(row.id)} className="font-semibold text-primary-600 hover:underline">{row.name}</Link>,
    },
    { key: "type", label: t("services.fields.type"), defaultVisible: true, render: (row) => serviceTypeLabel(t, row.serviceType) },
    { key: "customer", label: t("orders.cols.customer"), defaultVisible: true, render: (row) => row.customerName ?? "—" },
    {
      key: "progress",
      label: t("services.fields.progress"),
      defaultVisible: true,
      align: "right",
      render: (row) => `${row.progressPercent}%`,
    },
    { key: "jobs", label: t("services.tabs.jobs"), defaultVisible: true, align: "right", render: (row) => `${row.openJobCount}/${row.jobCount}` },
    { key: "assets", label: t("services.fields.assets"), defaultVisible: true, align: "right", render: (row) => row.assetCount },
    { key: "claims", label: t("services.tabs.warranty"), defaultVisible: true, align: "right", render: (row) => row.openClaimCount },
    {
      key: "stage",
      label: t("services.fields.stage"),
      required: true,
      render: (row) => <ServiceBadge label={row.serviceStage ? t(`services.stages.${row.serviceStage}` as never) : "—"} tone={row.serviceStage === "completed" ? "success" : "default"} />,
    },
  ];

  return (
    <DataTableShell
      tableId="services.projects"
      rows={rows}
      columns={columns}
      getRowId={(row) => row.id}
      minWidth="980px"
      renderExpanded={(row) => (
        <div className="grid gap-3 bg-surface px-4 py-4 sm:grid-cols-2 lg:grid-cols-4">
          <Text size="sm" text={row.address ?? "—"} />
          <Text size="sm" text={t("services.summary.openJobs", { count: row.openJobCount })} />
          <Text size="sm" text={t("services.summary.assets", { count: row.assetCount })} />
          <Link href={Routes.project(row.id)} className="text-right text-sm font-semibold text-primary-600 hover:underline">{t("projects.viewDetail")}</Link>
        </div>
      )}
    />
  );
}

export function ServiceJobsTable({ rows }: { rows: ServiceJobRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<ServiceJobRow>[] = [
    { key: "code", label: t("orders.cols.code"), required: true, render: (row) => <span className="font-mono text-xs font-semibold">{row.code}</span> },
    { key: "project", label: t("projects.cols.name"), defaultVisible: true, render: (row) => <Link href={Routes.project(row.projectId)} className="font-medium text-primary-600 hover:underline">{row.projectName}</Link> },
    { key: "title", label: t("services.fields.job"), defaultVisible: true, render: (row) => row.title },
    { key: "type", label: t("services.fields.type"), defaultVisible: false, render: (row) => serviceTypeLabel(t, row.serviceType) },
    { key: "assignee", label: t("services.fields.assignee"), defaultVisible: true, render: (row) => row.assignedToName ?? "—" },
    { key: "schedule", label: t("services.fields.schedule"), defaultVisible: true, render: (row) => row.scheduledAt ? formatDate(row.scheduledAt) : "—" },
    {
      key: "checklist",
      label: t("services.fields.checklist"),
      defaultVisible: true,
      align: "right",
      render: (row) => `${row.checklist.filter((item) => item.completed).length}/${row.checklist.length}`,
    },
    { key: "status", label: t("orders.cols.status"), required: true, render: (row) => <ServiceJobStatusAction jobId={row.id} status={row.status} /> },
  ];

  return <DataTableShell tableId="services.jobs" rows={rows} columns={columns} getRowId={(row) => row.id} minWidth="1020px" />;
}

export function WarrantyClaimsTable({ rows }: { rows: WarrantyClaimRow[] }) {
  const t = useTranslations();
  const columns: DataTableColumn<WarrantyClaimRow>[] = [
    { key: "code", label: t("orders.cols.code"), required: true, render: (row) => <span className="font-mono text-xs font-semibold">{row.code}</span> },
    { key: "project", label: t("projects.cols.name"), defaultVisible: true, render: (row) => <Link href={Routes.project(row.projectId)} className="font-medium text-primary-600 hover:underline">{row.projectName}</Link> },
    { key: "issue", label: t("services.fields.issue"), defaultVisible: true, render: (row) => row.title },
    { key: "asset", label: t("services.fields.asset"), defaultVisible: true, render: (row) => row.assetName ?? "—" },
    { key: "reported", label: t("services.fields.reportedAt"), defaultVisible: true, render: (row) => formatDate(row.reportedAt) },
    { key: "priority", label: t("services.fields.priority"), defaultVisible: false, render: (row) => t(`services.priorities.${row.priority}` as never) },
    { key: "status", label: t("orders.cols.status"), required: true, render: (row) => <WarrantyClaimStatusAction claimId={row.id} status={row.status} /> },
  ];

  return <DataTableShell tableId="services.warranty" rows={rows} columns={columns} getRowId={(row) => row.id} minWidth="900px" />;
}

export function ServiceJobQuickCreate({
  projects,
  assignees,
}: {
  projects: ProjectOption[];
  assignees: AssigneeOption[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [serviceType, setServiceType] = useState(() => {
    const initial = projects[0]?.serviceType;
    return initial && initial !== "mixed" ? initial : "camera";
  });
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [assignedTo, setAssignedTo] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!projectId || !title.trim() || busy) return;
    setBusy(true);
    setError("");
    const result = await createServiceJob({
      projectId,
      serviceType: serviceType as "camera" | "electrical" | "plumbing",
      title,
      priority: priority as "low" | "normal" | "high" | "urgent",
      assignedTo: assignedTo || null,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setTitle("");
      setScheduledAt("");
      router.refresh();
    } else setError(t(result.error as never));
  }

  if (!open) return <Button type="button" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t("services.jobs.create")}</Button>;

  return (
    <div className="grid gap-2 rounded-card border border-border bg-surface p-3 sm:grid-cols-2 lg:grid-cols-3">
      <Select value={projectId} onChange={(event) => {
        const nextProjectId = event.target.value;
        setProjectId(nextProjectId);
        const projectType = projects.find((project) => project.id === nextProjectId)?.serviceType;
        if (projectType && projectType !== "mixed") setServiceType(projectType);
      }} options={projects.map((project) => ({ value: project.id, label: project.name }))} placeholder={t("projects.cols.name")} />
      <Select value={serviceType} onChange={(event) => setServiceType(event.target.value)} options={concreteTypeOptions(t)} />
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${t("services.fields.job")} *`} />
      <Select value={priority} onChange={(event) => setPriority(event.target.value)} options={priorityOptions(t)} />
      <Select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} options={[{ value: "", label: t("services.fields.unassigned") }, ...assignees.map((item) => ({ value: item.id, label: item.name }))]} />
      <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} aria-label={t("services.fields.schedule")} />
      {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2 lg:col-span-3" text={error} />}
      <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-3">
        <Button type="button" onClick={submit} disabled={!projectId || !title.trim()} loading={busy} tx="common.save" />
        <Button type="button" variant="ghost" size="iconSm" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function WarrantyClaimQuickCreate({ projects }: { projects: ProjectOption[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!projectId || !title.trim() || busy) return;
    setBusy(true);
    setError("");
    const result = await createWarrantyClaim({
      projectId,
      title,
      priority: priority as "low" | "normal" | "high" | "urgent",
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setTitle("");
      router.refresh();
    } else setError(t(result.error as never));
  }

  if (!open) return <Button type="button" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t("services.warranty.create")}</Button>;

  return (
    <div className="grid gap-2 rounded-card border border-border bg-surface p-3 sm:grid-cols-3">
      <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} options={projects.map((project) => ({ value: project.id, label: project.name }))} />
      <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${t("services.fields.issue")} *`} />
      <Select value={priority} onChange={(event) => setPriority(event.target.value)} options={priorityOptions(t)} />
      {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-3" text={error} />}
      <div className="flex justify-end gap-2 sm:col-span-3">
        <Button type="button" onClick={submit} disabled={!projectId || !title.trim()} loading={busy} tx="common.save" />
        <Button type="button" variant="ghost" size="iconSm" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function InstalledAssetQuickCreate({
  projectId,
  jobs,
}: {
  projectId: string;
  jobs: { id: string; code: string; title: string }[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState("");
  const [assetKind, setAssetKind] = useState("camera");
  const [name, setName] = useState("");
  const [serialNumber, setSerialNumber] = useState("");
  const [locationLabel, setLocationLabel] = useState("");
  const [macAddress, setMacAddress] = useState("");
  const [ipAddress, setIpAddress] = useState("");
  const [customerWarrantyEndsOn, setCustomerWarrantyEndsOn] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || !assetKind.trim() || busy) return;
    setBusy(true);
    setError("");
    const result = await createInstalledAsset({
      projectId,
      jobId: jobId || null,
      assetKind,
      name,
      serialNumber: serialNumber || undefined,
      locationLabel: locationLabel || undefined,
      macAddress: macAddress || undefined,
      ipAddress: ipAddress || undefined,
      customerWarrantyEndsOn: customerWarrantyEndsOn || null,
      installedAt: new Date().toISOString(),
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setName("");
      setSerialNumber("");
      setLocationLabel("");
      setMacAddress("");
      setIpAddress("");
      setCustomerWarrantyEndsOn("");
      router.refresh();
    } else setError(t(result.error as never));
  }

  if (!open) return <Button type="button" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t("services.assets.create")}</Button>;

  return (
    <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
      <Select value={jobId} onChange={(event) => setJobId(event.target.value)} options={[{ value: "", label: t("services.fields.unassigned") }, ...jobs.map((job) => ({ value: job.id, label: `${job.code} · ${job.title}` }))]} />
      <Input value={assetKind} onChange={(event) => setAssetKind(event.target.value)} placeholder={`${t("services.fields.assetKind")} *`} />
      <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={`${t("services.fields.asset")} *`} />
      <Input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} placeholder={t("services.fields.serialNumber")} />
      <Input value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} placeholder={t("services.fields.location")} />
      <Input value={macAddress} onChange={(event) => setMacAddress(event.target.value)} placeholder={t("services.fields.macAddress")} />
      <Input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} placeholder={t("services.fields.ipAddress")} />
      <Input type="date" value={customerWarrantyEndsOn} onChange={(event) => setCustomerWarrantyEndsOn(event.target.value)} aria-label={t("services.tabs.warranty")} />
      {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2 lg:col-span-4" text={error} />}
      <div className="flex justify-end gap-2 sm:col-span-2 lg:col-span-4">
        <Button type="button" onClick={submit} disabled={!name.trim() || !assetKind.trim()} loading={busy} tx="common.save" />
        <Button type="button" variant="ghost" size="iconSm" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
      </div>
    </div>
  );
}

export function ServiceChecklistEditor({
  jobId,
  checklist,
}: {
  jobId: string;
  checklist: ServiceChecklistItem[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [items, setItems] = useState(checklist);
  const [busyCode, setBusyCode] = useState<string | null>(null);

  async function toggle(code: string, completed: boolean) {
    const previous = items;
    const next = items.map((item) => item.code === code ? { ...item, completed } : item);
    setItems(next);
    setBusyCode(code);
    const result = await updateServiceChecklist(jobId, next);
    setBusyCode(null);
    if (result.ok) router.refresh();
    else setItems(previous);
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div key={item.code} className="flex items-center justify-between gap-3 border-b border-border-soft pb-2 last:border-b-0">
          <Text size="sm" className={cn(item.completed && "text-slate-400 line-through")} text={t(item.labelKey as never)} />
          <Toggle checked={item.completed} disabled={busyCode === item.code} onChange={(value) => toggle(item.code, value)} aria-label={t(item.labelKey as never)} />
        </div>
      ))}
    </div>
  );
}

function ServiceJobStatusAction({ jobId, status }: { jobId: string; status: ServiceJobStatus }) {
  const t = useTranslations();
  const router = useRouter();
  const [value, setValue] = useState<ServiceJobStatus>(status);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (value === status) return;
    setBusy(true);
    const result = await transitionServiceJob({ jobId, status: value });
    setBusy(false);
    if (result.ok) router.refresh();
    else setValue(status);
  }

  return (
    <span onClick={stopRowToggle} className="inline-flex items-center gap-1.5">
      <Select size="sm" value={value} onChange={(event) => setValue(event.target.value as ServiceJobStatus)} options={jobStatusOptions(t)} />
      {value !== status && <Button type="button" size="sm" onClick={save} loading={busy} tx="common.save" />}
    </span>
  );
}

function WarrantyClaimStatusAction({ claimId, status }: { claimId: string; status: WarrantyClaimStatus }) {
  const t = useTranslations();
  const router = useRouter();
  const [value, setValue] = useState<WarrantyClaimStatus>(status);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (value === status) return;
    setBusy(true);
    const result = await transitionWarrantyClaim({ claimId, status: value });
    setBusy(false);
    if (result.ok) router.refresh();
    else setValue(status);
  }

  return (
    <span onClick={stopRowToggle} className="inline-flex items-center gap-1.5">
      <Select size="sm" value={value} onChange={(event) => setValue(event.target.value as WarrantyClaimStatus)} options={claimStatusOptions(t)} />
      {value !== status && <Button type="button" size="sm" onClick={save} loading={busy} tx="common.save" />}
    </span>
  );
}

function ServiceBadge({ label, tone }: { label: string; tone: "default" | "success" }) {
  return <span className={cn("inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium", tone === "success" ? "bg-in-soft text-in" : "bg-surface-2 text-slate-600")}>{label}</span>;
}

function serviceTypeLabel(t: ReturnType<typeof useTranslations>, type: string | null) {
  return type ? t(`services.types.${type}` as never) : "—";
}

function concreteTypeOptions(t: ReturnType<typeof useTranslations>) {
  return ["camera", "electrical", "plumbing"].map((value) => ({ value, label: t(`services.types.${value}` as never) }));
}

function priorityOptions(t: ReturnType<typeof useTranslations>) {
  return ["low", "normal", "high", "urgent"].map((value) => ({ value, label: t(`services.priorities.${value}` as never) }));
}

function jobStatusOptions(t: ReturnType<typeof useTranslations>) {
  return ["new", "scheduled", "in_progress", "waiting_materials", "waiting_customer", "completed", "warranty", "cancelled"].map((value) => ({ value, label: t(`services.jobStatuses.${value}` as never) }));
}

function claimStatusOptions(t: ReturnType<typeof useTranslations>) {
  return ["new", "scheduled", "in_progress", "waiting_materials", "waiting_supplier", "resolved", "closed", "void"].map((value) => ({ value, label: t(`services.claimStatuses.${value}` as never) }));
}
