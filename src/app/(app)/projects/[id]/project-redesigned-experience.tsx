import {
  AlertTriangle,
  CalendarClock,
  Camera,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  ClipboardList,
  FileText,
  HardHat,
  House,
  Link2,
  MapPin,
  PackageCheck,
  Server,
  ShieldCheck,
  Wrench,
  Zap,
  Droplets,
} from "lucide-react";
import type { ProjectDetail } from "@/lib/data/projects";
import { evaluateServiceProjectClose } from "@/lib/services/project-close";
import type { getServiceFormOptions } from "@/lib/data/services";
import { formatCurrency, formatDate } from "@/lib/utils";
import {
  ServiceChecklistEditor,
  ServiceCostEditor,
  ServiceHandoverEditor,
  ServiceJobEdit,
  ServiceJobQuickCreate,
  ServiceJobStatusAction,
  ServiceMaintenanceEditor,
  WarrantyClaimQuickCreate,
  WarrantyClaimStatusAction,
} from "../../services/service-widgets";
import { ServiceInstallationBatchCreate } from "../../services/service-installation-batch-create";
import { ProjectServiceTab, ProjectServiceTabs } from "./project-service-tabs";
import { CameraAccessPanel } from "./camera-access-panel";
import { TradeRecordEditor } from "./trade-record-editor";
import { InstalledAssetPhotoThumbnail } from "./installed-asset-photo-thumbnail";
import {
  CoordinatedProjectMediaPanel,
  ProjectMediaRecordLinks,
  ProjectMediaUploadButton,
  ProjectMediaUploadCoordinator,
  type ProjectMediaPhase,
} from "./project-media-panel";

type ServiceOptions = Awaited<ReturnType<typeof getServiceFormOptions>>;

const tradeMeta = {
  camera: { label: "Camera", icon: Camera, tone: "text-primary-700", bar: "bg-primary-600", soft: "bg-primary-50" },
  electrical: { label: "Điện", icon: Zap, tone: "text-amber-600", bar: "bg-amber-500", soft: "bg-amber-50" },
  plumbing: { label: "Nước", icon: Droplets, tone: "text-blue-600", bar: "bg-blue-600", soft: "bg-blue-50" },
} as const;

const AFTERCARE_MEDIA_PHASES = [
  "after_installation",
  "acceptance",
  "handover",
] as const satisfies readonly ProjectMediaPhase[];

export function ProjectRedesignedExperience({
  detail,
  serviceOptions,
}: {
  detail: ProjectDetail;
  serviceOptions: ServiceOptions;
}) {
  const { project, jobs, assets, claims } = detail;
  const openClaims = claims.filter((claim) => !["closed", "void"].includes(claim.status));
  const cameraAssets = assets.filter((asset) => {
    const job = jobs.find((item) => item.id === asset.jobId);
    return project.serviceType === "camera"
      || job?.serviceType === "camera"
      || /camera|nvr|dvr|đầu ghi|dau ghi/i.test(asset.assetKind);
  });
  const tabs = {
    execution: jobs.length,
    installation: assets.length + detail.materials.length,
    aftercare: detail.maintenancePlans.filter((plan) => plan.isActive).length + openClaims.length,
    finance: detail.handoverDocuments.length + detail.costEntries.length,
  };

  return (
    <div className="space-y-5" data-project-redesign="full-flow-v2">
      <ProjectPulse detail={detail} />
      <ProjectMediaUploadCoordinator key={project.id} initialItems={detail.projectAttachments}>
        <ProjectServiceTabs initialActive="overview">
        <ProjectServiceTab id="overview" label="Tổng quan" icon={<House />}>
          <OverviewTab detail={detail} serviceOptions={serviceOptions} />
        </ProjectServiceTab>
        <ProjectServiceTab id="execution" label="Thi công" icon={<Wrench />} count={tabs.execution}>
          <ExecutionTab detail={detail} serviceOptions={serviceOptions} />
        </ProjectServiceTab>
        <ProjectServiceTab id="installation" label="Vật tư & thiết bị" icon={<PackageCheck />} count={tabs.installation}>
          <InstallationTab detail={detail} cameraAssets={cameraAssets} serviceOptions={serviceOptions} />
        </ProjectServiceTab>
        <ProjectServiceTab id="aftercare" label="Sau lắp đặt" icon={<ClipboardCheck />} count={tabs.aftercare}>
          <AftercareTab detail={detail} serviceOptions={serviceOptions} />
        </ProjectServiceTab>
        <ProjectServiceTab id="finance" label="Tài chính & hồ sơ" icon={<FileText />} count={tabs.finance}>
          <FinanceTab detail={detail} serviceOptions={serviceOptions} />
        </ProjectServiceTab>
        </ProjectServiceTabs>
      </ProjectMediaUploadCoordinator>
    </div>
  );
}

function ProjectPulse({ detail }: { detail: ProjectDetail }) {
  const { project, jobs, assets, claims } = detail;
  const openClaims = claims.filter((claim) => !["closed", "void"].includes(claim.status)).length;
  return (
    <section className="grid overflow-hidden rounded-2xl border border-border bg-surface shadow-sm sm:grid-cols-2 lg:grid-cols-4">
      <PulseMetric id="progress" icon={<ProgressRing value={project.progressPercent} />} label="Tiến độ" value={`${project.progressPercent}%`} />
      <PulseMetric id="devices" icon={<Server className="h-6 w-6" />} label="Thiết bị đã lắp" value={String(assets.filter((asset) => asset.status === "installed").length)} />
      <PulseMetric id="jobs" icon={<ClipboardList className="h-6 w-6" />} label="Lệnh việc" value={String(jobs.length)} />
      <PulseMetric id="warranty" icon={<ShieldCheck className="h-6 w-6" />} label="Bảo hành đang mở" value={String(openClaims)} danger={openClaims > 0} />
    </section>
  );
}

function PulseMetric({ id, icon, label, value, danger }: { id: string; icon: React.ReactNode; label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex min-h-28 items-center gap-4 border-b border-border-soft px-5 py-4 last:border-b-0 sm:[&:nth-child(odd)]:border-r lg:border-b-0 lg:border-r lg:last:border-r-0">
      <span data-project-pulse-icon={id} className={danger ? "text-er" : "text-primary-700"}>{icon}</span>
      <div><p className="text-sm text-slate-500">{label}</p><p className={danger ? "text-2xl font-bold text-er" : "text-2xl font-bold"}>{value}</p></div>
    </div>
  );
}

function ProgressRing({ value }: { value: number }) {
  return (
    <div className="relative grid h-14 w-14 place-items-center rounded-full" style={{ background: `conic-gradient(var(--color-primary-600) ${value * 3.6}deg, var(--color-surface-2) 0)` }}>
      <span className="h-10 w-10 rounded-full bg-surface" />
      <CheckCircle2 className="absolute h-5 w-5 text-primary-700" />
    </div>
  );
}

function OverviewTab({ detail, serviceOptions }: { detail: ProjectDetail; serviceOptions: ServiceOptions }) {
  const { project, jobs, assets, claims, maintenancePlans, orders, statusLogs } = detail;
  const nextAction = deriveNextAction(detail);
  const recent = [
    ...statusLogs.map((log) => ({ id: `status-${log.id}`, kind: "status" as const, date: log.createdAt, title: log.note || `Cập nhật ${log.toStatus}`, meta: log.createdByName })),
    ...assets.map((asset) => ({ id: `asset-${asset.id}`, kind: "asset" as const, date: asset.installedAt ?? asset.createdAt, title: `Ghi nhận thiết bị: ${asset.name}`, meta: asset.locationLabel })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()).slice(0, 6);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,.85fr)]">
      <div className="space-y-4">
        <Panel title="Việc cần làm tiếp theo">
          <div className="flex flex-col gap-4 rounded-xl border border-primary-200 bg-gradient-to-r from-primary-50 to-surface px-4 py-4 sm:flex-row sm:items-center">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary-100 text-primary-700">{nextAction.icon}</span>
            <div className="min-w-0 flex-1"><p className="font-semibold">{nextAction.title}</p><p className="mt-1 text-sm text-slate-500">{nextAction.hint}</p></div>
            {nextAction.kind === "create-job"
              ? <ServiceJobQuickCreate
                  projects={[{ id: project.id, name: project.name, serviceType: project.serviceType }]}
                  assignees={serviceOptions.assigneeOptions}
                  triggerLabel={nextAction.cta}
                  triggerClassName="shrink-0"
                  showTriggerIcon={false}
                />
              : <span className="inline-flex min-h-11 items-center justify-center rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white">{nextAction.cta}</span>}
          </div>
        </Panel>
        {project.serviceType === "mixed" && <TradeProgress jobs={jobs} />}
        <Panel title="Hoạt động gần đây">
          {recent.length ? <div className="space-y-0">{recent.map((event, index) => <div key={event.id} className="relative flex gap-3 pb-5 last:pb-0"><span data-project-activity-icon={event.kind} className="relative z-10 grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary-50 text-primary-700 ring-4 ring-surface">{event.kind === "asset" ? <Camera className="h-4 w-4" /> : <ShieldCheck className="h-4 w-4" />}</span>{index < recent.length - 1 && <span className="absolute bottom-0 left-[15px] top-8 w-px bg-border" />}<div className="pt-0.5"><p className="text-sm font-semibold">{event.title}</p><p className="mt-1 text-xs text-slate-500">{formatDate(event.date)}{event.meta ? ` · ${event.meta}` : ""}</p></div></div>)}</div> : <Empty text="Chưa có hoạt động thi công." />}
        </Panel>
      </div>
      <div className="space-y-4">
        <Panel title="Thông tin công trình" flush>
          <InfoRow label="Khách hàng" value={project.customerName ?? "—"} />
          <InfoRow label="Địa chỉ" value={project.address ?? "—"} />
          <InfoRow label="Liên hệ" value={[project.siteContactName, project.siteContactPhone].filter(Boolean).join(" · ") || "—"} />
          <InfoRow label="Dịch vụ" value={serviceTypeLabel(project.serviceType)} />
          <InfoRow label="Giai đoạn" value={serviceStageLabel(project.serviceStage)} />
          <InfoRow label="Lịch trình" value={`${project.startsOn ? formatDate(project.startsOn) : "—"} – ${project.targetEndsOn ? formatDate(project.targetEndsOn) : "—"}`} />
        </Panel>
        <Panel title="Đơn & báo giá liên quan">
          {orders.length ? orders.slice(0, 5).map((order) => <div key={order.id} className="flex items-center justify-between gap-3 border-b border-border-soft py-2 last:border-0"><div><p className="font-mono text-xs font-semibold text-primary-700">{order.code}</p><p className="text-xs text-slate-500">{order.status === "quote" ? "Báo giá" : "Đơn hàng"}</p></div><p className="text-sm font-semibold">{formatCurrency(Number(order.total))}</p></div>) : <Empty text="Chưa có đơn hoặc báo giá." />}
        </Panel>
        <Panel title="Sau lắp đặt">
          <div className="grid grid-cols-3 gap-2 text-center"><MiniStat label="Bảo trì" value={maintenancePlans.filter((plan) => plan.isActive).length} /><MiniStat label="Bảo hành" value={claims.filter((claim) => !["closed", "void"].includes(claim.status)).length} /><MiniStat label="Thiết bị" value={assets.length} /></div>
        </Panel>
      </div>
    </div>
  );
}

function ExecutionTab({ detail, serviceOptions }: { detail: ProjectDetail; serviceOptions: ServiceOptions }) {
  const { project, jobs, materials, dependencies, coordinationPoints } = detail;
  const materialByJob = new Map(jobs.map((job) => [job.id, materials.filter((material) => material.jobId === job.id)]));
  return (
    <div className="space-y-4">
      {project.serviceType === "mixed" && (
        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]">
          <Panel title="Điều phối liên bộ môn" subtitle="Mỗi lệnh việc thuộc đúng một bộ môn; phụ thuộc và điểm giao được theo dõi tại cấp công trình.">
            <TradeProgress jobs={jobs} />
            <div className="mt-4 space-y-2">{dependencies.length ? dependencies.map((dependency) => {
              const before = jobs.find((job) => job.id === dependency.predecessorJobId);
              const after = jobs.find((job) => job.id === dependency.successorJobId);
              return <div key={dependency.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-border-soft px-3 py-3 text-sm"><span data-project-coordination-icon="dependency" className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-slate-600"><Link2 className="h-4 w-4" /></span><StatusDot status={dependency.status} /><span className="font-medium">{before?.title ?? "Lệnh trước"}</span><span className="text-slate-400">→</span><span className="font-medium">{after?.title ?? "Lệnh sau"}</span><span className="ml-auto text-xs text-slate-500">{dependency.status}</span></div>;
            }) : <Empty text="Chưa có quan hệ phụ thuộc liên bộ môn." />}</div>
          </Panel>
          <Panel title="Điểm giao kỹ thuật" subtitle={`${coordinationPoints.length} điểm đang được theo dõi`}>
            <div className="space-y-2">{coordinationPoints.length ? coordinationPoints.map((point) => <div key={point.id} className="rounded-xl border border-border-soft p-3"><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2"><span data-project-coordination-icon="point" className="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary-50 text-primary-700"><MapPin className="h-4 w-4" /></span><div className="min-w-0"><p className="font-semibold">{point.title}</p><p className="mt-1 text-xs text-slate-500">{point.locationLabel ?? "Chưa có vị trí"}</p></div></div><StatusPill status={point.status} /></div><div className="mt-3 flex flex-wrap gap-1">{point.serviceTypes.map((type) => <TradePill key={type} type={type} />)}</div>{point.description && <p className="mt-2 text-xs text-slate-600">{point.description}</p>}</div>) : <Empty text="Chưa có điểm giao kỹ thuật." />}</div>
          </Panel>
        </section>
      )}
      <Panel title="Lệnh việc & thi công" subtitle={`${jobs.filter((job) => !["completed", "cancelled"].includes(job.status)).length} lệnh đang mở`} action={<ServiceJobQuickCreate projects={[{ id: project.id, name: project.name, serviceType: project.serviceType! }]} assignees={serviceOptions.assigneeOptions} />}>
        {jobs.length ? <div className="grid gap-4 xl:grid-cols-2">{jobs.map((job) => {
          const concreteType = job.serviceType === "mixed" ? "camera" : job.serviceType;
          const editableType = job.serviceType === "camera" || job.serviceType === "electrical" || job.serviceType === "plumbing"
            ? job.serviceType
            : null;
          const meta = tradeMeta[concreteType];
          const Icon = meta.icon;
          const completed = job.checklist.filter((item) => item.completed).length;
          const record = job.tradeRecord as { measurements?: Array<{ label?: string; value?: string | number; unit?: string; passed?: boolean }>; safety?: Array<{ completed?: boolean }> } | null;
          return <article key={job.id} className="overflow-hidden rounded-xl border border-border bg-surface"><header className="flex flex-wrap items-start gap-3 border-b border-border-soft p-4"><span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${meta.soft} ${meta.tone}`}><Icon className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><p className="font-mono text-xs font-semibold text-slate-500">{job.code}</p><TradePill type={concreteType} /></div><h3 className="mt-1 font-semibold">{job.title}</h3><p className="mt-1 text-xs text-slate-500">{job.assignedToName ?? "Chưa phân công"}{job.scheduledAt ? ` · ${formatDate(job.scheduledAt)}` : ""}</p></div><ServiceJobStatusAction jobId={job.id} status={job.status} /></header><div className="grid gap-4 p-4 md:grid-cols-2"><div><div className="mb-2 flex items-center justify-between"><p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Checklist</p><span className="font-mono text-xs">{completed}/{job.checklist.length}</span></div><ServiceChecklistEditor jobId={job.id} checklist={job.checklist} /></div><div className="space-y-3"><div className="rounded-lg bg-surface-2 p-3"><p className="text-xs font-semibold text-slate-500">Hồ sơ bộ môn</p><p className="mt-1 text-sm font-semibold">{record ? "Đã có dữ liệu kiểm tra" : "Chưa ghi phép đo / chứng cứ"}</p>{record?.measurements?.slice(0, 3).map((measurement, index) => <p key={index} className="mt-1 text-xs text-slate-600">{measurement.label}: {measurement.value}{measurement.unit ? ` ${measurement.unit}` : ""}</p>)}</div><div className="rounded-lg bg-surface-2 p-3"><p className="text-xs font-semibold text-slate-500">Vật tư</p><p className="mt-1 text-sm font-semibold">{materialByJob.get(job.id)?.length ?? 0} dòng vật tư</p></div><div className="flex flex-wrap justify-end gap-2">{editableType && <TradeRecordEditor jobId={job.id} serviceType={editableType} initial={job.tradeRecord} />}<ServiceJobEdit job={job} projectType={project.serviceType!} assignees={serviceOptions.assigneeOptions} orders={detail.orders.map((order) => ({ id: order.id, code: order.code, status: order.status }))} /></div></div></div></article>;
        })}</div> : <Empty text="Chưa có lệnh việc. Tạo lệnh theo đúng bộ môn để bắt đầu thi công." />}
      </Panel>
    </div>
  );
}

function InstallationTab({
  detail,
  cameraAssets,
  serviceOptions,
}: {
  detail: ProjectDetail;
  cameraAssets: ProjectDetail["assets"];
  serviceOptions: ServiceOptions;
}) {
  const { project, jobs, assets, materials, orders } = detail;
  return (
    <div className="space-y-4">
      <Panel
        title="Vật tư & thiết bị"
        subtitle={`${materials.length} dòng sử dụng · ${assets.length} thiết bị theo dõi`}
        action={(
          <ServiceInstallationBatchCreate
            project={{ id: project.id, name: project.name, customerId: project.customerId }}
            jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))}
            orders={orders.map((order) => ({ id: order.id, code: order.code, status: order.status }))}
            warehouses={serviceOptions.warehouseOptions}
          />
        )}
      >
        <div className="grid gap-5 xl:grid-cols-[minmax(0,.9fr)_minmax(0,1.1fr)]">
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Sử dụng cho thi công</h3>
              <span className="text-xs font-semibold text-slate-400">{materials.length} dòng</span>
            </div>
            {materials.length ? (
              <div className="space-y-2">
                {materials.map((material) => {
                  const issued = Number(material.issuedBaseQuantity) > 0;
                  const reserved = Number(material.reservedBaseQuantity) > 0;
                  return <div key={material.id} className="rounded-xl border border-border-soft p-3"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><p className="truncate text-sm font-semibold">{material.productName}</p><p className="mt-1 truncate text-xs text-slate-500">{material.jobCode} · {material.sku}</p></div><span className={`shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ${issued ? "bg-primary-50 text-primary-700" : reserved ? "bg-blue-50 text-blue-700" : "bg-surface-2 text-slate-500"}`}>{issued ? "Đã xuất kho" : reserved ? "Đã giữ hàng" : "Chưa xử lý kho"}</span></div><p className="mt-2 text-xs">Đã dùng <strong>{Number(material.usedQuantity)}</strong> / {Number(material.plannedQuantity)} {material.unitName}</p></div>;
                })}
              </div>
            ) : <Empty text="Chưa có sản phẩm sử dụng cho thi công." />}
          </section>
          <section>
            <div className="mb-3 flex items-center justify-between gap-3">
              <h3 className="text-xs font-bold uppercase tracking-wide text-slate-500">Thiết bị theo dõi</h3>
              <span className="text-xs font-semibold text-slate-400">{assets.length} thiết bị</span>
            </div>
            {assets.length ? <div className="grid gap-3 sm:grid-cols-2">{assets.map((asset) => <div key={asset.id} className="rounded-xl border border-border-soft p-3"><div className="flex items-start gap-3"><InstalledAssetPhotoThumbnail assetId={asset.id} assetName={asset.name} /><div className="min-w-0 flex-1"><div className="flex items-start justify-between gap-2"><div className="min-w-0"><p className="truncate font-semibold">{asset.name}</p><p className="mt-1 truncate text-xs text-slate-500">{[asset.brand, asset.model].filter(Boolean).join(" ") || asset.assetKind}</p></div><StatusPill status={asset.status} /></div><dl className="mt-3 grid grid-cols-2 gap-2 text-xs"><div><dt className="text-slate-500">Vị trí</dt><dd className="mt-0.5 truncate font-medium">{asset.locationLabel ?? "—"}</dd></div><div><dt className="text-slate-500">Serial</dt><dd className="mt-0.5 truncate font-mono">{asset.serialNumber ?? "—"}</dd></div></dl></div></div></div>)}</div> : <Empty text="Chưa ghi nhận thiết bị theo dõi." />}
          </section>
        </div>
      </Panel>
      {(project.serviceType === "camera" || project.serviceType === "mixed") && (
        <Panel title="Truy cập Camera/NVR an toàn" subtitle="Thông tin bí mật được mã hóa riêng; không xuất hiện trong biên bản bàn giao.">
          <CameraAccessPanel assets={cameraAssets} />
        </Panel>
      )}
    </div>
  );
}

function AftercareTab({ detail, serviceOptions }: { detail: ProjectDetail; serviceOptions: ServiceOptions }) {
  const { project, jobs, assets, handoverDocuments, maintenancePlans, claims } = detail;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
        <Panel title="Nghiệm thu & bàn giao" subtitle={`${handoverDocuments.length} hồ sơ`} action={<ServiceHandoverEditor projectId={project.id} jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))} />}>
          <div className="space-y-2">{handoverDocuments.length ? handoverDocuments.map((document) => {
            const mediaPhase = projectMediaPhaseForDocument(document.type);
            return (
              <RecordCard
                key={document.id}
                title={document.title}
                meta={`${document.type} · ${document.status}`}
                detail={document.signedBy ? `Ký bởi ${document.signedBy}` : "Chưa ký"}
                action={mediaPhase ? <ProjectMediaUploadButton phase={mediaPhase} documentId={document.id} /> : undefined}
              >
                <ProjectMediaRecordLinks documentId={document.id} />
              </RecordCard>
            );
          }) : <Empty text="Chưa có hồ sơ nghiệm thu hoặc bàn giao." />}</div>
        </Panel>
        <Panel title="Bảo trì định kỳ" subtitle={`${maintenancePlans.filter((plan) => plan.isActive).length} lịch đang chạy`} action={<ServiceMaintenanceEditor projectId={project.id} projectServiceType={project.serviceType!} assets={assets.map((asset) => ({ id: asset.id, name: asset.name, serialNumber: asset.serialNumber }))} staff={serviceOptions.assigneeOptions} />}>
          <div className="space-y-2">{maintenancePlans.length ? maintenancePlans.map((plan) => <RecordCard key={plan.id} title={plan.title} meta={plan.assetName ?? serviceTypeLabel(plan.serviceType)} detail={`Kỳ tới ${formatDate(plan.nextDueOn)}`} />) : <Empty text="Chưa có lịch bảo trì." />}</div>
        </Panel>
        <Panel title="Bảo hành" subtitle={`${claims.filter((claim) => !["closed", "void"].includes(claim.status)).length} yêu cầu đang mở`} action={<WarrantyClaimQuickCreate projects={[{ id: project.id, name: project.name, serviceType: project.serviceType! }]} jobs={jobs.map((job) => ({ id: job.id, projectId: project.id, code: job.code, title: job.title }))} assets={assets.map((asset) => ({ id: asset.id, projectId: project.id, jobId: asset.jobId, name: asset.name, serialNumber: asset.serialNumber }))} />}>
          <div className="space-y-2">{claims.length ? claims.map((claim) => <div key={claim.id} className="rounded-xl border border-border-soft p-3"><div className="flex items-start justify-between gap-2"><div><p className="text-sm font-semibold">{claim.title}</p><p className="mt-1 text-xs text-slate-500">{claim.code} · {claim.assetName ?? "Toàn công trình"}</p></div><WarrantyClaimStatusAction claimId={claim.id} status={claim.status} diagnosis={claim.diagnosis} resolution={claim.resolution} /></div></div>) : <Empty text="Chưa có yêu cầu bảo hành." />}</div>
        </Panel>
        <div className="xl:col-span-3">
          <CoordinatedProjectMediaPanel projectId={project.id} phaseFilter={AFTERCARE_MEDIA_PHASES} />
        </div>
    </div>
  );
}

function FinanceTab({ detail, serviceOptions }: { detail: ProjectDetail; serviceOptions: ServiceOptions }) {
  const { project, jobs, profitability, costEntries, handoverDocuments, dependencies, coordinationPoints } = detail;
  const financials = profitability ?? { revenue: 0, materialCost: 0, laborCost: 0, otherCost: 0, grossProfit: 0 };
  const closeState = evaluateServiceProjectClose({
    serviceType: project.serviceType!,
    jobStatuses: jobs.map((job) => job.status),
    handoverDocuments,
    dependencies,
    coordinationPoints,
  });
  return (
    <div className="space-y-4">
      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><FinanceMetric label="Doanh thu" value={financials.revenue} /><FinanceMetric label="Chi phí vật tư" value={financials.materialCost} /><FinanceMetric label="Chi phí nhân công & khác" value={financials.laborCost + financials.otherCost} /><FinanceMetric label="Lợi nhuận gộp" value={financials.grossProfit} success={financials.grossProfit >= 0} /></section>
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.25fr)_minmax(340px,.75fr)]">
        <Panel title="Chi phí công trình" subtitle={`${costEntries.length} khoản chi`} action={<ServiceCostEditor projectId={project.id} jobs={jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))} staff={serviceOptions.assigneeOptions} />}>
          {costEntries.length ? <div className="space-y-2">{costEntries.map((entry) => <div key={entry.id} className="flex items-center justify-between gap-3 border-b border-border-soft py-2 last:border-0"><div><p className="text-sm font-semibold">{entry.description}</p><p className="text-xs text-slate-500">{entry.type} · {entry.incurredOn}{entry.staffName ? ` · ${entry.staffName}` : ""}</p></div><p className="font-semibold">{formatCurrency(Number(entry.amount))}</p></div>)}</div> : <Empty text="Chưa ghi nhận chi phí ngoài vật tư." />}
        </Panel>
        <Panel title="Điều kiện đóng công trình">
          <CloseCheck ok={closeState.incompleteJobs === 0} label={closeState.incompleteJobs === 0 ? "Tất cả lệnh việc đã hoàn tất" : `Còn ${closeState.incompleteJobs} lệnh việc chưa hoàn tất`} />
          <CloseCheck ok={closeState.coordinationBlockers === 0} label={closeState.coordinationBlockers === 0 ? "Không còn điểm giao/phụ thuộc bắt buộc" : `Còn ${closeState.coordinationBlockers} chặn điều phối`} />
          <CloseCheck ok={closeState.handoverSigned} label="Biên bản bàn giao đã ký" />
          <div className={closeState.canClose ? "mt-4 rounded-xl bg-ok-soft p-3 text-sm font-semibold text-ok" : "mt-4 rounded-xl bg-warn-soft p-3 text-sm font-semibold text-warn"}>{closeState.canClose ? "Sẵn sàng đóng công trình" : "Chưa đủ điều kiện đóng công trình"}</div>
        </Panel>
      </div>
      <Panel title="Hồ sơ công trình" subtitle={`${handoverDocuments.length} tài liệu`}><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{handoverDocuments.length ? handoverDocuments.map((document) => <RecordCard key={document.id} title={document.title} meta={document.type} detail={document.status === "signed" ? `Đã ký${document.signedBy ? ` · ${document.signedBy}` : ""}` : "Bản nháp"} />) : <Empty text="Chưa có hồ sơ." />}</div></Panel>
      <CoordinatedProjectMediaPanel projectId={project.id} loadItems={false} receiveUploadSignal={false} />
    </div>
  );
}

function TradeProgress({ jobs }: { jobs: ProjectDetail["jobs"] }) {
  return <div className="grid gap-3 sm:grid-cols-3">{(["camera", "electrical", "plumbing"] as const).map((type) => {
    const rows = jobs.filter((job) => job.serviceType === type);
    const completed = rows.filter((job) => job.status === "completed").length;
    const value = rows.length ? Math.round((completed / rows.length) * 100) : 0;
    const meta = tradeMeta[type];
    const Icon = meta.icon;
    return <div key={type} className="rounded-xl border border-border-soft p-3"><div className="flex items-center justify-between gap-2"><span className={`flex items-center gap-2 text-sm font-semibold ${meta.tone}`}><Icon className="h-4 w-4" />{meta.label}</span><span className="font-mono text-xs">{value}%</span></div><div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2"><span className={`block h-full rounded-full ${meta.bar}`} style={{ width: `${value}%` }} /></div><p className="mt-2 text-xs text-slate-500">{completed}/{rows.length} lệnh hoàn tất</p></div>;
  })}</div>;
}

function Panel({ title, subtitle, action, children, flush = false }: { title: string; subtitle?: string; action?: React.ReactNode; children: React.ReactNode; flush?: boolean }) {
  return <section className="overflow-hidden rounded-xl border border-border bg-surface"><header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-soft px-4 py-3"><div><h2 className="font-semibold">{title}</h2>{subtitle && <p className="mt-1 text-xs text-slate-500">{subtitle}</p>}</div>{action}</header><div className={flush ? "" : "p-4"}>{children}</div></section>;
}

function Empty({ text }: { text: string }) { return <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-slate-500">{text}</div>; }
function InfoRow({ label, value }: { label: string; value: string }) { return <div className="grid grid-cols-[120px_1fr] gap-3 border-b border-border-soft px-4 py-3 text-sm last:border-0"><span className="text-slate-500">{label}</span><span className="font-medium">{value}</span></div>; }
function MiniStat({ label, value }: { label: string; value: number }) { return <div className="rounded-lg bg-surface-2 px-2 py-3"><p className="text-xl font-bold">{value}</p><p className="mt-1 text-[11px] text-slate-500">{label}</p></div>; }
function RecordCard({ title, meta, detail, action, children }: { title: string; meta: string; detail: string; action?: React.ReactNode; children?: React.ReactNode }) { return <div className="rounded-xl border border-border-soft p-3"><div className="flex items-start gap-2"><FileText className="mt-0.5 h-4 w-4 shrink-0 text-primary-600" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{title}</p><p className="mt-1 text-xs text-slate-500">{meta}</p><p className="mt-2 text-xs">{detail}</p>{children}</div>{action}</div></div>; }
function FinanceMetric({ label, value, success }: { label: string; value: number; success?: boolean }) { return <div className="rounded-xl border border-border bg-surface p-4"><p className="text-xs text-slate-500">{label}</p><p className={success ? "mt-2 text-xl font-bold text-ok" : "mt-2 text-xl font-bold"}>{formatCurrency(value)}</p></div>; }
function CloseCheck({ ok, label }: { ok: boolean; label: string }) { return <div className="flex items-center gap-2 border-b border-border-soft py-2 text-sm last:border-0">{ok ? <CheckCircle2 className="h-4 w-4 text-ok" /> : <AlertTriangle className="h-4 w-4 text-warn" />}<span>{label}</span></div>; }
function StatusDot({ status }: { status: string }) { return <span className={status === "blocked" ? "h-2.5 w-2.5 rounded-full bg-er" : status === "completed" ? "h-2.5 w-2.5 rounded-full bg-ok" : "h-2.5 w-2.5 rounded-full bg-warn"} />; }
function StatusPill({ status }: { status: string }) { const ok = ["installed", "resolved", "completed", "ready", "signed"].includes(status); const danger = ["blocked", "repair"].includes(status); return <span className={danger ? "rounded-full bg-er-soft px-2 py-1 text-[11px] font-semibold text-er" : ok ? "rounded-full bg-ok-soft px-2 py-1 text-[11px] font-semibold text-ok" : "rounded-full bg-warn-soft px-2 py-1 text-[11px] font-semibold text-warn"}>{status}</span>; }

function projectMediaPhaseForDocument(type: string): ProjectMediaPhase | null {
  if (type === "survey") return null;
  if (type === "handover") return "handover";
  return "acceptance";
}
function TradePill({ type }: { type: "camera" | "electrical" | "plumbing" }) { const meta = tradeMeta[type]; const Icon = meta.icon; return <span className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-semibold ${meta.soft} ${meta.tone}`}><Icon className="h-3 w-3" />{meta.label}</span>; }
function serviceTypeLabel(type: ProjectDetail["project"]["serviceType"] | "camera" | "electrical" | "plumbing") { return type === "camera" ? "Camera" : type === "electrical" ? "Điện" : type === "plumbing" ? "Nước" : type === "mixed" ? "Khác" : "—"; }

function serviceStageLabel(stage: ProjectDetail["project"]["serviceStage"]) {
  return stage === "quoted" ? "Báo giá"
    : stage === "planning" ? "Lập kế hoạch"
      : stage === "active" ? "Thi công"
        : stage === "paused" ? "Tạm dừng"
          : stage === "completed" ? "Hoàn tất"
            : stage === "warranty" ? "Bảo hành"
              : stage === "cancelled" ? "Đã hủy"
                : "—";
}

function deriveNextAction(detail: ProjectDetail) {
  const workAlreadyComplete = detail.project.progressPercent >= 100 || detail.project.serviceStage === "completed";
  if (detail.jobs.length === 0 && !workAlreadyComplete) return { kind: "create-job" as const, icon: <HardHat className="h-5 w-5" />, title: "Tạo lệnh việc đầu tiên", hint: "Chia phạm vi thi công theo đúng bộ môn và phân công người phụ trách.", cta: "Tạo lệnh việc" };
  if (detail.jobs.some((job) => !["completed", "cancelled"].includes(job.status))) return { kind: "execution" as const, icon: <Wrench className="h-5 w-5" />, title: "Tiếp tục thi công", hint: "Hoàn tất checklist, phép đo, chứng cứ và chữ ký cho các lệnh đang mở.", cta: "Xem thi công" };
  if (detail.assets.length === 0) return { kind: "devices" as const, icon: <PackageCheck className="h-5 w-5" />, title: "Ghi nhận thiết bị đã lắp", hint: "Lưu vị trí, serial, thông số và thời hạn bảo hành.", cta: "Thêm thiết bị" };
  if (!detail.maintenancePlans.some((plan) => plan.isActive)) return { kind: "maintenance" as const, icon: <CalendarClock className="h-5 w-5" />, title: "Lập lịch bảo trì đầu tiên", hint: "Thiết bị đã được ghi nhận nhưng chưa có lịch kiểm tra định kỳ.", cta: "Lập lịch bảo trì" };
  if (!detail.handoverDocuments.some((document) => document.type === "handover" && document.status === "signed")) return { kind: "handover" as const, icon: <ClipboardCheck className="h-5 w-5" />, title: "Hoàn tất nghiệm thu & bàn giao", hint: "Tổng hợp hồ sơ theo bộ môn và lấy chữ ký bàn giao.", cta: "Lập hồ sơ" };
  return { kind: "finance" as const, icon: <CircleDollarSign className="h-5 w-5" />, title: "Đối soát tài chính & đóng công trình", hint: "Kiểm tra chi phí, hồ sơ và các điều kiện còn lại trước khi đóng.", cta: "Kiểm tra hồ sơ" };
}
