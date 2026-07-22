"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { DataTableShell, RowPreviewModal, stopRowToggle, type DataTableColumn } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import { Toggle } from "@/components/ui/toggle";
import {
  createInstalledAsset,
  createServiceJob,
  createWarrantyClaim,
  saveServiceJobMaterial,
  transitionServiceJob,
  transitionWarrantyClaim,
  updateServiceJob,
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
import { ProjectEdit } from "../projects/project-widgets";

type ProjectOption = { id: string; name: string; serviceType: string | null };
type AssigneeOption = { id: string; name: string };
type ProductOption = { id: string; name: string; sku: string; baseUnit: string };

export function ServiceProjectsTable({ rows, customers }: { rows: ServiceProjectRow[]; customers: { id: string; name: string }[] }) {
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
    {
      key: "actions",
      label: "",
      required: true,
      width: "64px",
      align: "right",
      render: (row) => <span onClick={stopRowToggle}><ProjectEdit project={row} customers={customers} /></span>,
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
  const [description, setDescription] = useState("");
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
      description: description || undefined,
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setTitle("");
      setScheduledAt("");
      setDescription("");
      router.refresh();
    } else setError(t(result.error as never));
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t("services.jobs.create")}</Button>
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("services.jobs.create")}
        closeLabel={t("common.close")}
        size="lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={submit} disabled={busy || !projectId || !title.trim()} loading={busy} tx="common.save" />
          </div>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select value={projectId} onChange={(event) => {
            const nextProjectId = event.target.value;
            setProjectId(nextProjectId);
            const projectType = projects.find((project) => project.id === nextProjectId)?.serviceType;
            if (projectType && projectType !== "mixed") setServiceType(projectType);
          }} options={projects.map((project) => ({ value: project.id, label: project.name }))} placeholder={t("projects.cols.name")} />
          <Select value={serviceType} onChange={(event) => setServiceType(event.target.value)} options={concreteTypeOptions(t)} />
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${t("services.fields.job")} *`} className="sm:col-span-2" />
          <Select value={priority} onChange={(event) => setPriority(event.target.value)} options={priorityOptions(t)} />
          <Select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} options={[{ value: "", label: t("services.fields.unassigned") }, ...assignees.map((item) => ({ value: item.id, label: item.name }))]} />
          <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} aria-label={t("services.fields.schedule")} className="sm:col-span-2" />
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("services.fields.description")} className="sm:col-span-2" />
          {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2" text={error} />}
        </div>
      </RowPreviewModal>
    </>
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

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t("services.warranty.create")}</Button>
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("services.warranty.create")}
        closeLabel={t("common.close")}
        size="md"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={submit} disabled={busy || !projectId || !title.trim()} loading={busy} tx="common.save" />
          </div>
        )}
      >
        <div className="grid gap-3">
          <Select value={projectId} onChange={(event) => setProjectId(event.target.value)} options={projects.map((project) => ({ value: project.id, label: project.name }))} />
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${t("services.fields.issue")} *`} />
          <Select value={priority} onChange={(event) => setPriority(event.target.value)} options={priorityOptions(t)} />
          {error && <Text as="p" variant="destructive" size="xs" text={error} />}
        </div>
      </RowPreviewModal>
    </>
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

  return (
    <>
      <Button type="button" size="sm" onClick={() => setOpen(true)}><Plus className="h-4 w-4" />{t("services.assets.create")}</Button>
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("services.assets.create")}
        closeLabel={t("common.close")}
        size="xl"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={submit} disabled={busy || !name.trim() || !assetKind.trim()} loading={busy} tx="common.save" />
          </div>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select value={jobId} onChange={(event) => setJobId(event.target.value)} options={[{ value: "", label: t("services.fields.unassigned") }, ...jobs.map((job) => ({ value: job.id, label: `${job.code} · ${job.title}` }))]} />
          <Input value={assetKind} onChange={(event) => setAssetKind(event.target.value)} placeholder={`${t("services.fields.assetKind")} *`} />
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={`${t("services.fields.asset")} *`} />
          <Input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} placeholder={t("services.fields.serialNumber")} />
          <Input value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} placeholder={t("services.fields.location")} />
          <Input value={macAddress} onChange={(event) => setMacAddress(event.target.value)} placeholder={t("services.fields.macAddress")} />
          <Input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} placeholder={t("services.fields.ipAddress")} />
          <Input type="date" value={customerWarrantyEndsOn} onChange={(event) => setCustomerWarrantyEndsOn(event.target.value)} aria-label={t("services.tabs.warranty")} />
          {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2" text={error} />}
        </div>
      </RowPreviewModal>
    </>
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

export function ServiceJobEdit({
  job,
  projectType,
  assignees,
}: {
  job: {
    id: string;
    serviceType: string;
    title: string;
    priority: string;
    assignedToName: string | null;
    assignedTo?: string | null;
    scheduledAt: Date | string | null;
    description: string | null;
  };
  projectType: string;
  assignees: AssigneeOption[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [serviceType, setServiceType] = useState(job.serviceType);
  const [title, setTitle] = useState(job.title);
  const [priority, setPriority] = useState(job.priority);
  const initialAssignee = assignees.find((item) => item.name === job.assignedToName)?.id ?? job.assignedTo ?? "";
  const [assignedTo, setAssignedTo] = useState(initialAssignee);
  const [scheduledAt, setScheduledAt] = useState(toDateTimeLocal(job.scheduledAt));
  const [description, setDescription] = useState(job.description ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!title.trim() || busy) return;
    setBusy(true);
    setError("");
    const result = await updateServiceJob({
      jobId: job.id,
      serviceType: serviceType as "camera" | "electrical" | "plumbing",
      title,
      priority: priority as "low" | "normal" | "high" | "urgent",
      assignedTo: assignedTo || null,
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
      description: description || undefined,
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else setError(t(result.error as never));
  }

  return (
    <>
      <Button type="button" variant="link" size="sm" className="h-auto px-0 text-xs" onClick={() => setOpen(true)} tx="common.edit" />
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("services.jobs.edit")}
        closeLabel={t("common.close")}
        size="lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={submit} disabled={busy || !title.trim()} loading={busy} tx="common.save" />
          </div>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            value={serviceType}
            onChange={(event) => setServiceType(event.target.value)}
            options={projectType === "mixed" ? concreteTypeOptions(t) : concreteTypeOptions(t).filter((item) => item.value === projectType)}
          />
          <Select value={priority} onChange={(event) => setPriority(event.target.value)} options={priorityOptions(t)} />
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${t("services.fields.job")} *`} className="sm:col-span-2" />
          <Select value={assignedTo} onChange={(event) => setAssignedTo(event.target.value)} options={[{ value: "", label: t("services.fields.unassigned") }, ...assignees.map((item) => ({ value: item.id, label: item.name }))]} />
          <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} aria-label={t("services.fields.schedule")} />
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("services.fields.description")} className="sm:col-span-2" />
          {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2" text={error} />}
        </div>
      </RowPreviewModal>
    </>
  );
}

export function ServiceMaterialEditor({
  jobs,
  products,
  initial,
}: {
  jobs: { id: string; code: string; title: string }[];
  products: ProductOption[];
  initial?: {
    jobId: string;
    productId: string;
    unitName: string;
    plannedQuantity: string;
    usedQuantity: string;
    note: string | null;
  };
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState(initial?.jobId ?? jobs[0]?.id ?? "");
  const [productId, setProductId] = useState(initial?.productId ?? products[0]?.id ?? "");
  const [unitName, setUnitName] = useState(initial?.unitName ?? products[0]?.baseUnit ?? "");
  const [plannedQuantity, setPlannedQuantity] = useState<number | null>(initial ? Number(initial.plannedQuantity) : 0);
  const [usedQuantity, setUsedQuantity] = useState<number | null>(initial ? Number(initial.usedQuantity) : 0);
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!jobId || !productId || !unitName.trim() || busy) return;
    setBusy(true);
    setError("");
    const result = await saveServiceJobMaterial({
      jobId,
      productId,
      unitName,
      plannedQuantity: plannedQuantity ?? 0,
      usedQuantity: usedQuantity ?? 0,
      note: note || undefined,
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else setError(t(result.error as never));
  }

  const disabled = jobs.length === 0 || products.length === 0;

  return (
    <>
      <Button
        type="button"
        variant={initial ? "link" : "outline"}
        size="sm"
        className={initial ? "h-auto px-0 text-xs" : undefined}
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        {initial ? t("common.edit") : <><Plus className="h-4 w-4" />{t("services.materials.create")}</>}
      </Button>
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t(initial ? "services.materials.edit" : "services.materials.create")}
        closeLabel={t("common.close")}
        size="lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={submit} disabled={busy || disabled || !unitName.trim()} loading={busy} tx="common.save" />
          </div>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            value={jobId}
            onChange={(event) => setJobId(event.target.value)}
            options={jobs.map((job) => ({ value: job.id, label: `${job.code} · ${job.title}` }))}
            disabled={Boolean(initial)}
          />
          <Select
            value={productId}
            onChange={(event) => {
              const nextId = event.target.value;
              setProductId(nextId);
              setUnitName(products.find((product) => product.id === nextId)?.baseUnit ?? "");
            }}
            options={products.map((product) => ({ value: product.id, label: `${product.sku} · ${product.name}` }))}
            disabled={Boolean(initial)}
          />
          <Input value={unitName} onChange={(event) => setUnitName(event.target.value)} placeholder={t("services.materials.unit")} disabled={Boolean(initial)} />
          <div />
          <NumberInput value={plannedQuantity} onChange={setPlannedQuantity} min={0} decimals={4} suffix={unitName} placeholder={t("services.materials.planned")} />
          <NumberInput value={usedQuantity} onChange={setUsedQuantity} min={0} decimals={4} suffix={unitName} placeholder={t("services.materials.used")} />
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("customers.fields.note")} className="sm:col-span-2" />
          {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2" text={error} />}
        </div>
      </RowPreviewModal>
    </>
  );
}

export function ServiceJobStatusAction({ jobId, status }: { jobId: string; status: ServiceJobStatus }) {
  const t = useTranslations();
  const router = useRouter();
  const [value, setValue] = useState<ServiceJobStatus>(status);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (value === status) return;
    setBusy(true);
    setError("");
    const result = await transitionServiceJob({ jobId, status: value, note: note || undefined });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      setNote("");
      router.refresh();
    } else {
      setError(t(result.error as never));
      setValue(status);
    }
  }

  return (
    <span onClick={stopRowToggle} className="inline-flex items-center gap-1.5">
      <Select size="sm" value={value} onChange={(event) => setValue(event.target.value as ServiceJobStatus)} options={jobStatusOptions(t)} />
      {value !== status && <Button type="button" size="sm" onClick={() => setOpen(true)} tx="common.save" />}
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("services.jobs.updateStatus")}
        subtitle={`${t(`services.jobStatuses.${status}` as never)} → ${t(`services.jobStatuses.${value}` as never)}`}
        closeLabel={t("common.close")}
        size="md"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={save} loading={busy} disabled={busy} tx="common.save" />
          </div>
        )}
      >
        <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("services.fields.statusNote")} />
        {error && <Text as="p" variant="destructive" size="xs" className="mt-3" text={error} />}
      </RowPreviewModal>
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

function toDateTimeLocal(value: Date | string | null) {
  if (!value) return "";
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
