import {
  CheckCircle2,
  FileStack,
  House,
  Images,
  MapPin,
  NotebookPen,
  Server,
} from "lucide-react";

import type { ProjectDetail } from "@/lib/data/projects";
import type { getServiceFormOptions } from "@/lib/data/services";
import { InstalledAssetQuickCreate } from "../../services/service-widgets";
import { InstalledAssetPhotoThumbnail } from "./installed-asset-photo-thumbnail";
import {
  CoordinatedProjectMediaPanel,
  ProjectMediaUploadCoordinator,
} from "./project-media-panel";
import { ProjectCompletionButton } from "./project-completion-button";
import { ProjectServiceTab, ProjectServiceTabs } from "./project-service-tabs";
import { ProjectNotesClient } from "./notes/project-notes-client";

type ServiceOptions = Awaited<ReturnType<typeof getServiceFormOptions>>;

export function ProjectSimpleExperience({
  detail,
  canManage,
}: {
  detail: ProjectDetail;
  serviceOptions: ServiceOptions;
  canManage: boolean;
}) {
  const { project, assets } = detail;
  const completed = project.status === "done" || project.serviceStage === "completed";
  const installedCount = assets.filter((asset) => asset.status === "installed").length;

  return (
    <div className="mx-auto max-w-6xl space-y-4" data-project-experience="simple">
      <section className="flex flex-col gap-4 rounded-2xl border border-border bg-surface p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between">
        <div className="grid flex-1 grid-cols-2 divide-x divide-border-soft">
          <SummaryMetric
            icon={<CheckCircle2 className="h-5 w-5" />}
            label="Trạng thái"
            value={completed ? "Hoàn thành" : "Đang thực hiện"}
          />
          <SummaryMetric
            icon={<Server className="h-5 w-5" />}
            label="Thiết bị"
            value={String(installedCount)}
          />
        </div>
        {canManage && (
          <ProjectCompletionButton projectId={project.id} completed={completed} />
        )}
      </section>

      <ProjectMediaUploadCoordinator key={project.id} initialItems={detail.projectAttachments}>
        <ProjectServiceTabs initialActive="overview">
          <ProjectServiceTab id="overview" label="Tổng quan" icon={<House />}>
            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(18rem,.72fr)]">
              <section className="overflow-hidden rounded-xl border border-border bg-surface">
                <header className="border-b border-border-soft px-4 py-3">
                  <h2 className="font-semibold">Thông tin công trình</h2>
                </header>
                <dl>
                  <InfoRow label="Khách hàng" value={project.customerName ?? "—"} />
                  <InfoRow label="Địa chỉ" value={project.address ?? "—"} />
                  <InfoRow
                    label="Lịch dự kiến"
                    value={formatSchedule(project.startsOn, project.targetEndsOn)}
                  />
                </dl>
              </section>

              <div>
                <div className="grid grid-cols-2 gap-3">
                  <QuickStat icon={<Server />} label="Thiết bị đã lắp" value={assets.length} />
                  <QuickStat icon={<FileStack />} label="Ảnh & tài liệu" value={detail.projectAttachments.length} />
                </div>
              </div>
            </div>
          </ProjectServiceTab>

          <ProjectServiceTab id="devices" label="Thiết bị" icon={<Server />} count={assets.length}>
            <section>
              <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-semibold">Thiết bị đã lắp</h2>
                  <p className="mt-1 text-xs text-slate-500">{assets.length} thiết bị trong công trình</p>
                </div>
                {canManage && (
                  <InstalledAssetQuickCreate
                    projectId={project.id}
                    serviceType={project.serviceType}
                    jobs={detail.jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))}
                  />
                )}
              </header>
              {assets.length ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {assets.map((asset) => (
                    <article key={asset.id} className="rounded-xl border border-border-soft bg-surface p-3">
                      <div className="flex items-start gap-3">
                        <InstalledAssetPhotoThumbnail assetId={asset.id} assetName={asset.name} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-start justify-between gap-2">
                            <div className="min-w-0">
                              <h3 className="truncate text-sm font-semibold">{asset.name}</h3>
                              <p className="mt-1 truncate text-xs text-slate-500">
                                {[asset.brand, asset.model].filter(Boolean).join(" ") || asset.assetKind}
                              </p>
                            </div>
                            {canManage && (
                              <InstalledAssetQuickCreate
                                projectId={project.id}
                                serviceType={project.serviceType}
                                jobs={detail.jobs.map((job) => ({ id: job.id, code: job.code, title: job.title }))}
                                initial={asset}
                              />
                            )}
                          </div>
                          <div className="mt-3 space-y-1.5 text-xs text-slate-500">
                            <p className="flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5" />{asset.locationLabel ?? "Chưa ghi vị trí"}</p>
                            <p className="font-mono">Serial: {asset.serialNumber ?? "—"}</p>
                          </div>
                        </div>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <EmptyState icon={<Server />} title="Chưa có thiết bị" text="Thêm thiết bị đã lắp vào công trình." />
              )}
            </section>
          </ProjectServiceTab>

          <ProjectServiceTab id="media" label="Ảnh & tài liệu" icon={<Images />} count={detail.projectAttachments.length}>
            <CoordinatedProjectMediaPanel projectId={project.id} />
          </ProjectServiceTab>

          <ProjectServiceTab id="notes" label="Ghi chú" icon={<NotebookPen />}>
            <ProjectNotesClient key={project.id} projectId={project.id} canManage={canManage} />
          </ProjectServiceTab>
        </ProjectServiceTabs>
      </ProjectMediaUploadCoordinator>
    </div>
  );
}

function SummaryMetric({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-3 px-3 first:pl-0 last:pr-0 sm:px-5">
      <span className="text-primary-700">{icon}</span>
      <span className="min-w-0">
        <span className="block text-xs text-slate-500">{label}</span>
        <strong className="block truncate text-sm sm:text-base">{value}</strong>
      </span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-3 border-b border-border-soft px-4 py-3 text-sm last:border-0">
      <dt className="text-slate-500">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function QuickStat({ icon, label, value }: { icon: React.ReactNode; label: string; value: number }) {
  return (
    <div className="rounded-xl bg-surface-2 p-3">
      <span className="text-primary-700 [&_svg]:h-4 [&_svg]:w-4">{icon}</span>
      <strong className="mt-3 block font-mono text-xl tabular-nums">{value}</strong>
      <span className="mt-1 block text-xs text-slate-500">{label}</span>
    </div>
  );
}

function EmptyState({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <div className="rounded-xl bg-surface-2 px-5 py-12 text-center">
      <span className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-primary-50 text-primary-700 [&_svg]:h-5 [&_svg]:w-5">{icon}</span>
      <h3 className="mt-3 font-semibold">{title}</h3>
      <p className="mt-1 text-sm text-slate-500">{text}</p>
    </div>
  );
}

function formatSchedule(start: string | null, end: string | null) {
  if (!start && !end) return "—";
  if (!start) return formatProjectDay(end!);
  if (!end) return formatProjectDay(start);
  return `${formatProjectDay(start)} – ${formatProjectDay(end)}`;
}

function formatProjectDay(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00`));
}
