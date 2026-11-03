"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale } from "next-intl";
import type { DatabaseBackupRunDto } from "@/lib/database-backups/service";

type BackupDataInfo = {
  included: readonly { id: string; vi: string; en: string }[];
  excluded: readonly { id: string; vi: string; en: string }[];
  storage: { vi: string; en: string };
  schedule: { vi: string; en: string };
  retention: { vi: string; en: string };
};

type BackupPayload = {
  runs: DatabaseBackupRunDto[];
  dataInfo: BackupDataInfo;
};

function formatBytes(bytes: number | null, isVietnamese: boolean): string {
  if (bytes == null) return "—";
  if (bytes < 1024) return `${bytes} ${isVietnamese ? "byte" : "bytes"}`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(isVietnamese ? "vi-VN" : "en-US", { maximumFractionDigits: 1 }).format(value)} ${units[unit]}`;
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Ho_Chi_Minh",
  }).format(date);
}

export function DatabaseBackupsPanel() {
  const locale = useLocale();
  const isVietnamese = locale === "vi";
  const [payload, setPayload] = useState<BackupPayload | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeRun = payload?.runs.find((run) => run.status === "queued" || run.status === "running");
  const active = Boolean(activeRun);

  const copy = isVietnamese
    ? {
        runNow: "Sao lưu ngay",
        queued: "Đã xếp yêu cầu sao lưu. Tác vụ thường bắt đầu trong vài phút.",
        alreadyActive: "Đang có một tác vụ sao lưu chờ hoặc đang chạy.",
        loadError: "Không tải được lịch sử sao lưu.",
        submitError: "Không gửi được yêu cầu sao lưu.",
        loading: "Đang tải…",
        retry: "Tải lại",
        scope: "Dữ liệu trong mỗi bản sao lưu",
        included: "Có trong bản sao lưu",
        excluded: "Không nằm trong bản sao lưu database này",
        storage: "Nơi lưu",
        schedule: "Lịch tự động",
        retention: "Thời hạn lưu",
        history: "Lịch sử sao lưu",
        empty: "Chưa có bản sao lưu nào.",
        automatic: "Tự động",
        manual: "Thủ công",
        status: { queued: "Đang chờ", running: "Đang sao lưu", succeeded: "Thành công", failed: "Thất bại" },
        size: "Dung lượng",
        duration: "Thời gian chạy",
        details: "Tệp trong bản sao lưu",
        seconds: "giây",
        refresh: "Làm mới lịch sử",
        manualPending: "Đang gửi yêu cầu…",
        updated: "Đã cập nhật lịch sử.",
        failure: "Tác vụ lỗi. Mã lỗi",
      }
    : {
        runNow: "Back up now",
        queued: "Backup request queued. The job usually starts within a few minutes.",
        alreadyActive: "A backup is already queued or running.",
        loadError: "Could not load backup history.",
        submitError: "Could not request a backup.",
        loading: "Loading…",
        retry: "Reload",
        scope: "Data in each backup",
        included: "Included",
        excluded: "Not included in this database backup",
        storage: "Storage",
        schedule: "Automatic schedule",
        retention: "Retention",
        history: "Backup history",
        empty: "No backups yet.",
        automatic: "Automatic",
        manual: "Manual",
        status: { queued: "Queued", running: "Backing up", succeeded: "Completed", failed: "Failed" },
        size: "Size",
        duration: "Run time",
        details: "Files in backup",
        seconds: "seconds",
        refresh: "Refresh history",
        manualPending: "Requesting…",
        updated: "Backup history refreshed.",
        failure: "The backup failed. Error code",
      };

  const load = useCallback(async (showError = true) => {
    try {
      const response = await fetch("/api/settings/database-backups", { cache: "no-store" });
      const result = await response.json() as { ok: boolean; data?: BackupPayload };
      if (!response.ok || !result.ok || !result.data) throw new Error(copy.loadError);
      setPayload(result.data);
      setError(null);
    } catch {
      if (showError) setError(copy.loadError);
    } finally {
      setIsLoading(false);
    }
  }, [copy.loadError]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (!active) return;
    const interval = window.setInterval(() => { void load(false); }, 8000);
    return () => window.clearInterval(interval);
  }, [active, load]);

  async function requestBackup() {
    setIsSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch("/api/settings/database-backups", { method: "POST" });
      const result = await response.json() as { ok: boolean; data?: { created: boolean }; error?: string };
      if (!response.ok || !result.ok) throw new Error(result.error || copy.submitError);
      setNotice(result.data?.created ? copy.queued : copy.alreadyActive);
      await load(false);
    } catch {
      setError(copy.submitError);
    } finally {
      setIsSubmitting(false);
    }
  }

  const runs = payload?.runs ?? [];
  const latestSuccess = runs.find((run) => run.status === "succeeded");

  return (
    <div className="space-y-4" data-testid="database-backups-panel">
      <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              {isVietnamese ? "Sao lưu database" : "Database backups"}
            </p>
            <p className="mt-1 text-sm text-slate-500">
              {isVietnamese ? "Bản lưu được tạo từ PostgreSQL và lưu riêng tư trên Cloudflare R2." : "Snapshots are created from PostgreSQL and stored privately in Cloudflare R2."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void requestBackup()}
            disabled={isSubmitting || isLoading || active}
            className="inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl bg-primary-600 px-4 text-sm font-semibold text-white transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
            data-testid="database-backups-run-now"
          >
            {isSubmitting ? copy.manualPending : activeRun ? copy.status[activeRun.status] : copy.runNow}
          </button>
        </div>
        {latestSuccess && (
          <p className="mt-3 text-xs text-slate-500">
            {isVietnamese ? "Lần thành công gần nhất:" : "Last successful backup:"} {formatDate(latestSuccess.finishedAt, locale)}
          </p>
        )}
        {error && <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{error}</p>}
        {notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}
      </section>

      {payload?.dataInfo && (
        <section className="rounded-2xl border border-border bg-surface p-4 shadow-sm md:p-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{copy.scope}</h2>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">{copy.included}</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                {payload.dataInfo.included.map((item) => <li key={item.id}>{isVietnamese ? item.vi : item.en}</li>)}
              </ul>
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">{copy.excluded}</h3>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-slate-600 dark:text-slate-300">
                {payload.dataInfo.excluded.map((item) => <li key={item.id}>{isVietnamese ? item.vi : item.en}</li>)}
              </ul>
            </div>
          </div>
          <dl className="mt-4 grid gap-3 border-t border-border-soft pt-4 text-sm sm:grid-cols-3">
            <div><dt className="text-xs text-slate-500">{copy.storage}</dt><dd className="mt-1 font-medium">{isVietnamese ? payload.dataInfo.storage.vi : payload.dataInfo.storage.en}</dd></div>
            <div><dt className="text-xs text-slate-500">{copy.schedule}</dt><dd className="mt-1 font-medium">{isVietnamese ? payload.dataInfo.schedule.vi : payload.dataInfo.schedule.en}</dd></div>
            <div><dt className="text-xs text-slate-500">{copy.retention}</dt><dd className="mt-1 font-medium">{isVietnamese ? payload.dataInfo.retention.vi : payload.dataInfo.retention.en}</dd></div>
          </dl>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-border bg-surface shadow-sm">
        <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3 md:px-5">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">{copy.history}</h2>
          <button type="button" onClick={() => { setNotice(copy.updated); void load(); }} className="min-h-10 rounded-lg px-3 text-sm font-medium text-primary-700 hover:bg-primary-50 dark:text-primary-300 dark:hover:bg-primary-950/30">
            {copy.refresh}
          </button>
        </div>
        {isLoading ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">{copy.loading}</p>
        ) : runs.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-slate-500">{copy.empty}</p>
        ) : (
          <ul className="divide-y divide-border-soft">
            {runs.map((run) => {
              const statusClass = run.status === "succeeded"
                ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300"
                : run.status === "failed"
                  ? "bg-red-50 text-red-700 dark:bg-red-950/30 dark:text-red-300"
                  : "bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300";
              const files = "files" in run.manifest && Array.isArray(run.manifest.files) ? run.manifest.files : [];
              return (
                <li key={run.id} className="px-4 py-4 md:px-5">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${statusClass}`}>{copy.status[run.status]}</span>
                        <span className="text-xs text-slate-500">{run.triggerType === "scheduled" ? copy.automatic : copy.manual}</span>
                      </div>
                      <p className="mt-2 text-sm font-medium text-slate-900 dark:text-slate-100">{formatDate(run.finishedAt ?? run.requestedAt, locale)}</p>
                      {run.status === "failed" && run.failureCode && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{copy.failure}: {run.failureCode}</p>}
                    </div>
                    <dl className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs text-slate-500 sm:min-w-48">
                      <dt>{copy.size}</dt><dd className="text-right font-medium text-slate-700 dark:text-slate-200">{formatBytes(run.archiveSizeBytes, isVietnamese)}</dd>
                      <dt>{copy.duration}</dt><dd className="text-right font-medium text-slate-700 dark:text-slate-200">{run.durationMilliseconds == null ? "—" : `${(run.durationMilliseconds / 1000).toFixed(1)} ${copy.seconds}`}</dd>
                    </dl>
                  </div>
                  {run.sha256 && <p className="mt-2 break-all font-mono text-[10px] text-slate-400">SHA-256: {run.sha256}</p>}
                  {files.length > 0 && (
                    <details className="mt-3 text-xs">
                      <summary className="cursor-pointer select-none font-medium text-primary-700 dark:text-primary-300">{copy.details} ({files.length})</summary>
                      <ul className="mt-2 grid gap-1 text-slate-500 sm:grid-cols-3">
                        {files.map((file) => (
                          <li key={file.name} className="min-w-0">
                            <span>{file.name} · {formatBytes(file.sizeBytes, isVietnamese)}</span>
                            <span className="block break-all font-mono text-[10px] text-slate-400">SHA-256: {file.sha256}</span>
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
