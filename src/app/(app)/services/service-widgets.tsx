"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
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
  syncServiceJobMaterialStock,
  transitionServiceJob,
  transitionWarrantyClaim,
  updateInstalledAsset,
  updateServiceJob,
  updateServiceChecklist,
  updateWarrantyClaim,
} from "@/lib/actions/services";
import type {
  ServiceJobRow,
  ServiceProjectRow,
  WarrantyClaimRow,
} from "@/lib/data/services";
import { Routes } from "@/lib/routes";
import { cn, formatDate } from "@/lib/utils";
import {
  canTransitionServiceJob,
  canTransitionWarrantyClaim,
  type ServiceChecklistItem,
  type ServiceJobStatus,
  type WarrantyClaimStatus,
} from "@/lib/services/domain";
import { ProjectEdit } from "../projects/project-widgets";

type ProjectOption = { id: string; name: string; serviceType: string | null };
type AssigneeOption = { id: string; name: string };
type ProductOption = { id: string; name: string; sku: string; baseUnit: string };
type WarrantyJobOption = { id: string; projectId: string; code: string; title: string };
type WarrantyAssetOption = { id: string; projectId: string; jobId: string | null; name: string; serialNumber: string | null };
type WarehouseOption = { id: string; name: string; isDefault: boolean };

export function ServiceDashboardFilters({
  tab,
  serviceType,
  status,
}: {
  tab: string;
  serviceType: string;
  status: string;
}) {
  const t = useTranslations();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const statuses = tab === "jobs"
    ? jobStatusOptions(t)
    : tab === "warranty"
      ? claimStatusOptions(t)
      : ["planning", "quoted", "active", "paused", "completed", "warranty", "cancelled"].map((value) => ({ value, label: t(`services.stages.${value}` as never) }));

  function update(key: "type" | "status", value: string) {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }

  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Select
        size="sm"
        value={serviceType}
        onChange={(event) => update("type", event.target.value)}
        options={[
          { value: "", label: t("services.filters.allTypes") },
          ...["camera", "electrical", "plumbing", "mixed"].map((value) => ({ value, label: t(`services.types.${value}` as never) })),
        ]}
        className="min-w-36"
      />
      <Select
        size="sm"
        value={status}
        onChange={(event) => update("status", event.target.value)}
        options={[{ value: "", label: t("services.filters.allStatuses") }, ...statuses]}
        className="min-w-44"
      />
    </div>
  );
}

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

export function WarrantyClaimQuickCreate({
  projects,
  jobs,
  assets,
  initial,
}: {
  projects: ProjectOption[];
  jobs: WarrantyJobOption[];
  assets: WarrantyAssetOption[];
  initial?: {
    id: string;
    jobId: string | null;
    assetId: string | null;
    title: string;
    description: string | null;
    priority: string;
    scheduledAt: Date | string | null;
    laborCharge: string;
    materialCharge: string;
  };
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.id ?? "");
  const [jobId, setJobId] = useState(initial?.jobId ?? "");
  const [assetId, setAssetId] = useState(initial?.assetId ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [priority, setPriority] = useState(initial?.priority ?? "normal");
  const [scheduledAt, setScheduledAt] = useState(initial ? toDateTimeLocal(initial.scheduledAt) : "");
  const [laborCharge, setLaborCharge] = useState<number | null>(initial ? Number(initial.laborCharge) : 0);
  const [materialCharge, setMaterialCharge] = useState<number | null>(initial ? Number(initial.materialCharge) : 0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!projectId || !title.trim() || busy) return;
    setBusy(true);
    setError("");
    const payload = {
      jobId: jobId || null,
      assetId: assetId || null,
      title,
      description: description || undefined,
      priority: priority as "low" | "normal" | "high" | "urgent",
      scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
    };
    const result = initial
      ? await updateWarrantyClaim({
          ...payload,
          claimId: initial.id,
          laborCharge: laborCharge ?? 0,
          materialCharge: materialCharge ?? 0,
        })
      : await createWarrantyClaim({ ...payload, projectId });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      if (!initial) {
        setTitle("");
        setDescription("");
        setScheduledAt("");
      }
      router.refresh();
    } else setError(t(result.error as never));
  }

  return (
    <>
      <Button type="button" variant={initial ? "link" : "default"} size={initial ? "sm" : "default"} className={initial ? "h-auto px-0 text-xs" : undefined} onClick={() => setOpen(true)}>
        {initial ? t("common.edit") : <><Plus className="h-4 w-4" />{t("services.warranty.create")}</>}
      </Button>
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t(initial ? "services.warranty.edit" : "services.warranty.create")}
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
            setProjectId(event.target.value);
            setJobId("");
            setAssetId("");
          }} options={projects.map((project) => ({ value: project.id, label: project.name }))} disabled={Boolean(initial)} />
          <Select value={priority} onChange={(event) => setPriority(event.target.value)} options={priorityOptions(t)} />
          <Select value={jobId} onChange={(event) => setJobId(event.target.value)} options={[{ value: "", label: t("services.warranty.noJob") }, ...jobs.filter((job) => job.projectId === projectId).map((job) => ({ value: job.id, label: `${job.code} · ${job.title}` }))]} />
          <Select value={assetId} onChange={(event) => {
            const nextId = event.target.value;
            setAssetId(nextId);
            const asset = assets.find((item) => item.id === nextId);
            if (asset?.jobId) setJobId(asset.jobId);
          }} options={[{ value: "", label: t("services.warranty.noAsset") }, ...assets.filter((asset) => asset.projectId === projectId).map((asset) => ({ value: asset.id, label: `${asset.name}${asset.serialNumber ? ` · ${asset.serialNumber}` : ""}` }))]} />
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={`${t("services.fields.issue")} *`} className="sm:col-span-2" />
          <Input type="datetime-local" value={scheduledAt} onChange={(event) => setScheduledAt(event.target.value)} aria-label={t("services.fields.schedule")} className="sm:col-span-2" />
          <Textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={t("services.fields.description")} className="sm:col-span-2" />
          {initial && (
            <>
              <NumberInput value={laborCharge} onChange={setLaborCharge} min={0} suffix="đ" placeholder={t("services.fields.laborCharge")} />
              <NumberInput value={materialCharge} onChange={setMaterialCharge} min={0} suffix="đ" placeholder={t("services.fields.materialCharge")} />
            </>
          )}
          {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2" text={error} />}
        </div>
      </RowPreviewModal>
    </>
  );
}

export function InstalledAssetQuickCreate({
  projectId,
  jobs,
  products,
  initial,
}: {
  projectId: string;
  jobs: { id: string; code: string; title: string }[];
  products: ProductOption[];
  initial?: {
    id: string;
    jobId: string | null;
    productId: string | null;
    assetKind: string;
    name: string;
    brand: string | null;
    model: string | null;
    serialNumber: string | null;
    macAddress: string | null;
    ipAddress: string | null;
    locationLabel: string | null;
    installedAt: Date | string | null;
    customerWarrantyEndsOn: string | null;
    supplierWarrantyEndsOn: string | null;
    status: "installed" | "repair" | "replaced" | "removed";
    note: string | null;
  };
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [jobId, setJobId] = useState(initial?.jobId ?? "");
  const [productId, setProductId] = useState(initial?.productId ?? "");
  const [assetKind, setAssetKind] = useState(initial?.assetKind ?? "camera");
  const [name, setName] = useState(initial?.name ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [model, setModel] = useState(initial?.model ?? "");
  const [serialNumber, setSerialNumber] = useState(initial?.serialNumber ?? "");
  const [locationLabel, setLocationLabel] = useState(initial?.locationLabel ?? "");
  const [macAddress, setMacAddress] = useState(initial?.macAddress ?? "");
  const [ipAddress, setIpAddress] = useState(initial?.ipAddress ?? "");
  const [installedAt, setInstalledAt] = useState(initial ? toDateTimeLocal(initial.installedAt) : toDateTimeLocal(new Date()));
  const [customerWarrantyEndsOn, setCustomerWarrantyEndsOn] = useState(initial?.customerWarrantyEndsOn ?? "");
  const [supplierWarrantyEndsOn, setSupplierWarrantyEndsOn] = useState(initial?.supplierWarrantyEndsOn ?? "");
  const [status, setStatus] = useState(initial?.status ?? "installed");
  const [note, setNote] = useState(initial?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || !assetKind.trim() || busy) return;
    setBusy(true);
    setError("");
    const payload = {
      jobId: jobId || null,
      productId: productId || null,
      assetKind,
      name,
      brand: brand || undefined,
      model: model || undefined,
      serialNumber: serialNumber || undefined,
      locationLabel: locationLabel || undefined,
      macAddress: macAddress || undefined,
      ipAddress: ipAddress || undefined,
      installedAt: installedAt ? new Date(installedAt).toISOString() : null,
      customerWarrantyEndsOn: customerWarrantyEndsOn || null,
      supplierWarrantyEndsOn: supplierWarrantyEndsOn || null,
      note: note || undefined,
    };
    const result = initial
      ? await updateInstalledAsset({ ...payload, assetId: initial.id, status })
      : await createInstalledAsset({ ...payload, projectId });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      if (!initial) {
        setName("");
        setBrand("");
        setModel("");
        setSerialNumber("");
        setLocationLabel("");
        setMacAddress("");
        setIpAddress("");
        setCustomerWarrantyEndsOn("");
        setSupplierWarrantyEndsOn("");
        setNote("");
      }
      router.refresh();
    } else setError(t(result.error as never));
  }

  return (
    <>
      <Button type="button" variant={initial ? "link" : "default"} size="sm" className={initial ? "h-auto px-0 text-xs" : undefined} onClick={() => setOpen(true)}>
        {initial ? t("common.edit") : <><Plus className="h-4 w-4" />{t("services.assets.create")}</>}
      </Button>
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t(initial ? "services.assets.edit" : "services.assets.create")}
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
          <Select value={productId} onChange={(event) => {
            const nextId = event.target.value;
            setProductId(nextId);
            const product = products.find((item) => item.id === nextId);
            if (product && !name.trim()) setName(product.name);
          }} options={[{ value: "", label: t("services.assets.noProduct") }, ...products.map((product) => ({ value: product.id, label: `${product.sku} · ${product.name}` }))]} />
          <Input value={assetKind} onChange={(event) => setAssetKind(event.target.value)} placeholder={`${t("services.fields.assetKind")} *`} />
          <Input value={name} onChange={(event) => setName(event.target.value)} placeholder={`${t("services.fields.asset")} *`} />
          <Input value={brand} onChange={(event) => setBrand(event.target.value)} placeholder={t("services.fields.brand")} />
          <Input value={model} onChange={(event) => setModel(event.target.value)} placeholder={t("services.fields.model")} />
          <Input value={serialNumber} onChange={(event) => setSerialNumber(event.target.value)} placeholder={t("services.fields.serialNumber")} />
          <Input value={locationLabel} onChange={(event) => setLocationLabel(event.target.value)} placeholder={t("services.fields.location")} />
          <Input value={macAddress} onChange={(event) => setMacAddress(event.target.value)} placeholder={t("services.fields.macAddress")} />
          <Input value={ipAddress} onChange={(event) => setIpAddress(event.target.value)} placeholder={t("services.fields.ipAddress")} />
          <Input type="datetime-local" value={installedAt} onChange={(event) => setInstalledAt(event.target.value)} aria-label={t("services.fields.installedAt")} />
          <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} options={["installed", "repair", "replaced", "removed"].map((value) => ({ value, label: t(`services.assetStatuses.${value}` as never) }))} disabled={!initial} />
          <Input type="date" value={customerWarrantyEndsOn} onChange={(event) => setCustomerWarrantyEndsOn(event.target.value)} aria-label={t("services.fields.customerWarranty")} />
          <Input type="date" value={supplierWarrantyEndsOn} onChange={(event) => setSupplierWarrantyEndsOn(event.target.value)} aria-label={t("services.fields.supplierWarranty")} />
          <Textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder={t("customers.fields.note")} className="sm:col-span-2" />
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
  orders,
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
    quoteOrderId: string | null;
    materialOrderId: string | null;
  };
  projectType: string;
  assignees: AssigneeOption[];
  orders: { id: string; code: string; status: string }[];
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
  const [quoteOrderId, setQuoteOrderId] = useState(job.quoteOrderId ?? "");
  const [materialOrderId, setMaterialOrderId] = useState(job.materialOrderId ?? "");
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
      quoteOrderId: quoteOrderId || null,
      materialOrderId: materialOrderId || null,
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
          <Select
            value={quoteOrderId}
            onChange={(event) => setQuoteOrderId(event.target.value)}
            options={[
              { value: "", label: t("services.jobs.noQuote") },
              ...orders.filter((order) => order.status === "quote").map((order) => ({ value: order.id, label: order.code })),
            ]}
          />
          <Select
            value={materialOrderId}
            onChange={(event) => setMaterialOrderId(event.target.value)}
            options={[
              { value: "", label: t("services.jobs.noMaterialOrder") },
              ...orders.filter((order) => order.status !== "quote" && order.status !== "cancelled").map((order) => ({ value: order.id, label: order.code })),
            ]}
          />
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

export function ServiceMaterialStockSync({
  material,
  warehouses,
}: {
  material: {
    id: string;
    unitName: string;
    usedQuantity: string;
    unitMultiplier: string;
    issuedBaseQuantity: string;
    stockWarehouseId: string | null;
  };
  warehouses: WarehouseOption[];
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [warehouseId, setWarehouseId] = useState(
    material.stockWarehouseId ?? warehouses.find((warehouse) => warehouse.isDefault)?.id ?? warehouses[0]?.id ?? "",
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const multiplier = Number(material.unitMultiplier);
  const issuedQuantity = multiplier > 0 ? Number(material.issuedBaseQuantity) / multiplier : 0;
  const isSynced = multiplier > 0
    && Math.abs(Number(material.usedQuantity) * multiplier - Number(material.issuedBaseQuantity)) < 0.0001;

  async function submit() {
    if (!warehouseId || busy) return;
    setBusy(true);
    setError("");
    const result = await syncServiceJobMaterialStock({ materialId: material.id, warehouseId });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else setError(t(result.error as never));
  }

  return (
    <>
      <div className="flex items-center gap-2">
        <Text
          size="xs"
          variant={isSynced ? "muted" : "destructive"}
          text={t("services.materials.issued", { quantity: Number(issuedQuantity.toFixed(4)), unit: material.unitName })}
        />
        {!isSynced && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setOpen(true)}
            disabled={warehouses.length === 0 || multiplier <= 0}
            tx="services.materials.syncStock"
          />
        )}
      </div>
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("services.materials.syncStockTitle")}
        closeLabel={t("common.close")}
        size="md"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={submit} disabled={busy || !warehouseId} loading={busy} tx="services.materials.syncStock" />
          </div>
        )}
      >
        <div className="space-y-3">
          <div>
            <Select
              value={warehouseId}
              onChange={(event) => setWarehouseId(event.target.value)}
              options={warehouses.map((warehouse) => ({ value: warehouse.id, label: warehouse.name }))}
              disabled={Boolean(material.stockWarehouseId)}
              aria-label={t("purchases.cols.warehouse")}
              className="w-full"
            />
          </div>
          <Text as="p" size="sm" text={t("services.materials.syncStockHint", {
            used: Number(material.usedQuantity),
            issued: Number(issuedQuantity.toFixed(4)),
            unit: material.unitName,
          })} />
          {error && <Text as="p" variant="destructive" size="xs" text={error} />}
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
      <Select
        size="sm"
        value={value}
        onChange={(event) => setValue(event.target.value as ServiceJobStatus)}
        options={jobStatusOptions(t).filter((option) => canTransitionServiceJob(status, option.value as ServiceJobStatus))}
      />
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

export function WarrantyClaimStatusAction({
  claimId,
  status,
  diagnosis: initialDiagnosis = "",
  resolution: initialResolution = "",
}: {
  claimId: string;
  status: WarrantyClaimStatus;
  diagnosis?: string | null;
  resolution?: string | null;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [value, setValue] = useState<WarrantyClaimStatus>(status);
  const [open, setOpen] = useState(false);
  const [diagnosis, setDiagnosis] = useState(initialDiagnosis ?? "");
  const [resolution, setResolution] = useState(initialResolution ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    if (value === status) return;
    setBusy(true);
    setError("");
    const result = await transitionWarrantyClaim({
      claimId,
      status: value,
      diagnosis: diagnosis || undefined,
      resolution: resolution || undefined,
    });
    setBusy(false);
    if (result.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(t(result.error as never));
      setValue(status);
    }
  }

  return (
    <span onClick={stopRowToggle} className="inline-flex items-center gap-1.5">
      <Select
        size="sm"
        value={value}
        onChange={(event) => setValue(event.target.value as WarrantyClaimStatus)}
        options={claimStatusOptions(t).filter((option) => canTransitionWarrantyClaim(status, option.value as WarrantyClaimStatus))}
      />
      {value !== status && <Button type="button" size="sm" onClick={() => setOpen(true)} tx="common.save" />}
      <RowPreviewModal
        open={open}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("services.warranty.updateStatus")}
        subtitle={`${t(`services.claimStatuses.${status}` as never)} → ${t(`services.claimStatuses.${value}` as never)}`}
        closeLabel={t("common.close")}
        size="lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={save} loading={busy} disabled={busy} tx="common.save" />
          </div>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Textarea value={diagnosis} onChange={(event) => setDiagnosis(event.target.value)} placeholder={t("services.fields.diagnosis")} />
          <Textarea value={resolution} onChange={(event) => setResolution(event.target.value)} placeholder={t("services.fields.resolution")} />
          {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2" text={error} />}
        </div>
      </RowPreviewModal>
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
