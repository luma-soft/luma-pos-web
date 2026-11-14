"use client";

import { useCallback, useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Activity, AlertTriangle, Check, Clock3, Database, HardDrive, RefreshCw, ServerCog, ShieldCheck } from "lucide-react";

type Worker = { status: string; lastSeenAt: string | null };
type BackupRun = {
  id: string;
  status: string;
  triggerType: string;
  requestedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  archiveKey: string | null;
  archiveSizeBytes: number | null;
  sha256: string | null;
  failureCode: string | null;
};
type Operations = {
  backend: { status: string; uptimeSeconds: number };
  readiness: {
    status: string;
    primaryDatabase: { status: string; confirmed: boolean };
    missingPrimary: string[];
    backup: { status: string; destinationConfigured: boolean; lastSuccessfulAt: string | null; blockers: string[] };
  };
  database: { status: string; blockers: string[] };
  media: { status: string; provider: "local" | "r2" | null; blockers: Record<string, boolean>; warnings: string[] };
  sync: { worker: Worker; queue: Record<string, number> };
  workers: { notifications: Worker; backups: Worker };
  backups: BackupRun[];
};

async function readEnvelope<T>(response: Response): Promise<T> {
  const body = await response.json() as { ok?: boolean; data?: T; error?: string };
  if (!response.ok || !body.ok || body.data === undefined) throw new Error(body.error ?? "REQUEST_FAILED");
  return body.data;
}

function formatDate(value: string | null, locale: string) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat(locale === "vi" ? "vi-VN" : "en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function formatBytes(value: number | null, locale: string) {
  if (value === null) return "—";
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let amount = value / 1024;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024;
    unit += 1;
  }
  return `${new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US", { maximumFractionDigits: 1 }).format(amount)} ${units[unit]}`;
}

function statusTone(status: string) {
  if (status === "not_required") return "bg-surface-2 text-slate-600 dark:text-slate-300";
  if (["online", "ready", "succeeded", "accepted"].includes(status)) {
    return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300";
  }
  if (["queued", "running", "processing", "pending", "not_required"].includes(status)) {
    return "bg-amber-50 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200";
  }
  return "bg-rose-50 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300";
}

function StatusBadge({ label, status }: { label: string; status: string }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-semibold ${statusTone(status)}`}>
      <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />{label}
    </span>
  );
}

function ReadinessCard({ icon: Icon, label, status, statusLabel, supporting }: {
  icon: typeof Database;
  label: string;
  status: string;
  statusLabel: string;
  supporting?: string;
}) {
  return (
    <article className="flex min-w-0 items-start gap-3 rounded-xl bg-surface-2 p-3.5">
      <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-surface text-primary-700 dark:text-primary-300">
        <Icon className="size-4" aria-hidden="true" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold leading-5">{label}</p>
        <div className="mt-2"><StatusBadge label={statusLabel} status={status} /></div>
        {supporting && <p className="mt-2 truncate text-xs text-slate-500" title={supporting}>{supporting}</p>}
      </div>
    </article>
  );
}

export function AdminOperationsPanel() {
  const t = useTranslations("admin");
  const locale = useLocale();
  const [operations, setOperations] = useState<Operations | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

  const load = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    setError(false);
    try {
      const response = await fetch("/api/admin/operations", { cache: "no-store" });
      setOperations(await readEnvelope<Operations>(response));
      setUpdatedAt(new Date().toISOString());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    const interval = window.setInterval(() => void load(true), 30_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [load]);

  const requestBackup = async () => {
    setBusy(true);
    setNotice(null);
    setError(false);
    try {
      const response = await fetch("/api/admin/operations", { method: "POST" });
      await readEnvelope<{ id: string }>(response);
      setNotice(t("backupQueued"));
      await load(true);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "BACKUP_ALREADY_RUNNING") {
        setNotice(t("backupAlreadyRunning"));
        await load(true);
      } else {
        setError(true);
      }
    } finally {
      setBusy(false);
    }
  };

  const displayStatus = (status: string) => {
    const known = ["online", "offline", "ready", "not_ready", "not_required", "pending", "processing", "accepted", "rejected", "conflict", "queued", "running", "succeeded", "failed"] as const;
    return t(`statuses.${known.includes(status as typeof known[number]) ? status : "offline"}` as "statuses.online");
  };

  const formatUptime = (seconds: number) => {
    if (seconds < 60) return t("uptimeLessThanMinute");
    const minutes = Math.floor(Math.max(0, seconds) / 60);
    const days = Math.floor(minutes / (24 * 60));
    const hours = Math.floor((minutes % (24 * 60)) / 60);
    const remainingMinutes = minutes % 60;
    if (days > 0) return t("uptimeDays", { days, hours });
    if (hours > 0) return t("uptimeHoursMinutes", { hours, minutes: remainingMinutes });
    return t("uptimeMinutes", { minutes: remainingMinutes });
  };

  const mediaBlockerLabels: Record<string, string> = {
    externalMediaReview: t("mediaBlockers.externalMediaReview"),
    supabaseManagedMedia: t("mediaBlockers.supabaseManagedMedia"),
    legacyServiceAttachments: t("mediaBlockers.legacyServiceAttachments"),
    legacyCustomerRequestAttachments: t("mediaBlockers.legacyCustomerRequestAttachments"),
    pendingRemoteRequestCleanup: t("mediaBlockers.pendingRemoteRequestCleanup"),
    legacyAiAttachments: t("mediaBlockers.legacyAiAttachments"),
    nonLocalManagedMedia: t("mediaBlockers.nonLocalManagedMedia"),
    unfinishedLocalMediaMigration: t("mediaBlockers.unfinishedLocalMediaMigration"),
    localMediaConfiguration: t("mediaBlockers.localMediaConfiguration"),
    localMediaRoot: t("mediaBlockers.localMediaRoot"),
    externalMediaPolicyInvalid: t("mediaBlockers.externalMediaPolicyInvalid"),
  };
  const activeMediaBlockers = Object.entries(operations?.media.blockers ?? {})
    .filter(([, blocked]) => blocked)
    .map(([key]) => mediaBlockerLabels[key] ?? t("mediaBlockers.unknown"));
  const activeMediaWarnings = (operations?.media.warnings ?? []).map((warning) => warning === "externalMediaPreservedUntilReview"
    ? t("mediaWarnings.externalMediaPreservedUntilReview")
    : t("mediaWarnings.unknown"));
  const backupBlockerLabels: Record<string, string> = {
    sourceConfirmation: t("backupBlockers.sourceConfirmation"),
    providerConfiguration: t("backupBlockers.providerConfiguration"),
    driveConfiguration: t("backupBlockers.driveConfiguration"),
    rcloneConfiguration: t("backupBlockers.rcloneConfiguration"),
    rcloneConfigurationUnavailable: t("backupBlockers.rcloneConfigurationUnavailable"),
    rcloneUnavailable: t("backupBlockers.rcloneUnavailable"),
    stagingRootConfiguration: t("backupBlockers.stagingRootConfiguration"),
    stagingRootUnavailable: t("backupBlockers.stagingRootUnavailable"),
    stagingRootNotPrivate: t("backupBlockers.stagingRootNotPrivate"),
    stagingRootInsideApplication: t("backupBlockers.stagingRootInsideApplication"),
    stagingRootInsideMedia: t("backupBlockers.stagingRootInsideMedia"),
    driveUnavailable: t("backupBlockers.driveUnavailable"),
    recentGoogleDriveBackup: t("backupBlockers.recentGoogleDriveBackup"),
  };
  const activeBackupBlockers = (operations?.readiness.backup.blockers ?? [])
    .map((blocker) => backupBlockerLabels[blocker] ?? t("backupBlockers.unknown"));
  const primaryBlockerLabels: Record<string, string> = {
    notConfirmed: t("primaryDatabaseBlockers.notConfirmed"),
  };
  const activePrimaryBlockers = (operations?.readiness.missingPrimary ?? [])
    .map((blocker) => primaryBlockerLabels[blocker] ?? t("primaryDatabaseBlockers.unknown"));
  const databaseBlockerLabels: Record<string, string> = {
    superuser: t("databaseBlockers.superuser"),
    createDatabase: t("databaseBlockers.createDatabase"),
    createRoles: t("databaseBlockers.createRoles"),
    replication: t("databaseBlockers.replication"),
    bypassRls: t("databaseBlockers.bypassRls"),
    databaseCreate: t("databaseBlockers.databaseCreate"),
    publicSchemaCreate: t("databaseBlockers.publicSchemaCreate"),
    ownsDatabase: t("databaseBlockers.ownsDatabase"),
    ownsPublicSchema: t("databaseBlockers.ownsPublicSchema"),
    ownsPublicObjects: t("databaseBlockers.ownsPublicObjects"),
  };
  const activeDatabaseBlockers = (operations?.database.blockers ?? [])
    .map((key) => databaseBlockerLabels[key] ?? t("databaseBlockers.unknown"));
  const hasActiveBackup = (operations?.backups ?? []).some((run) => ["queued", "running", "processing"].includes(run.status));

  const renderBlockers = (title: string, items: string[]) => items.length === 0 ? null : (
    <div role="status" className="rounded-xl border border-amber-200 bg-amber-50/70 p-4 text-sm text-amber-950 dark:border-amber-900 dark:bg-amber-950/25 dark:text-amber-100">
      <h4 className="font-semibold">{title}</h4>
      <ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">{items.map((item) => <li key={item}>{item}</li>)}</ul>
    </div>
  );

  return (
    <div className="space-y-5">
      <header className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-primary-700 dark:text-primary-300">{t("operations")}</p>
          <h2 className="mt-1 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">{t("backendLocalTitle")}</h2>
          <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{t("backendLocalDescription")}</p>
        </div>
        <div className="flex shrink-0 items-center gap-3">
          <p className="text-right text-xs text-slate-500">
            {updatedAt ? t("lastUpdated", { time: formatDate(updatedAt, locale) }) : t("autoRefresh")}
            <span className="mt-1 block">{t("autoRefresh")}</span>
          </p>
          <button type="button" onClick={() => void load()} disabled={loading || refreshing} className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-medium transition hover:bg-surface-2 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50">
            <RefreshCw className={`size-4 ${refreshing || loading ? "animate-spin" : ""}`} />{t("refresh")}
          </button>
        </div>
      </header>

      {error && <p role="alert" className="rounded-lg bg-rose-50 px-4 py-3 text-sm text-rose-700 dark:bg-rose-950/30 dark:text-rose-300">{t("operationsLoadError")}</p>}
      {notice && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}

      {operations ? <>
        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.88fr)_minmax(0,1.45fr)]">
          <section className="relative overflow-hidden rounded-2xl border border-border bg-surface p-5 sm:p-6">
            <div className="pointer-events-none absolute -right-10 -top-12 size-40 rounded-full bg-primary-100/70 blur-3xl dark:bg-primary-900/20" />
            <div className="relative">
              <div className="flex items-center justify-between gap-3">
                <span className="grid size-11 place-items-center rounded-xl bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300"><ServerCog className="size-5" /></span>
                <StatusBadge status={operations.backend.status} label={displayStatus(operations.backend.status)} />
              </div>
              <p className="mt-6 text-sm font-medium text-slate-500">{t("backend")}</p>
              <h3 className="mt-1 text-2xl font-bold tracking-tight">{t("backendLocalTitle")}</h3>
              <p className="mt-2 text-sm text-slate-500">{t("backendUptime", { duration: formatUptime(operations.backend.uptimeSeconds) })}</p>
              <div className="mt-5 flex items-center gap-2 border-t border-border-soft pt-4 text-sm">
                {operations.readiness.status === "ready" ? <Check className="size-4 text-emerald-600" /> : <AlertTriangle className="size-4 text-amber-600" />}
                <span className="font-semibold">{t("readiness")}: {displayStatus(operations.readiness.status)}</span>
              </div>
              <p className="mt-2 text-xs leading-5 text-slate-500">{operations.readiness.status === "ready" ? t("readySummary") : t("notReadySummary")}</p>
            </div>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Activity className="size-4 text-primary-600" aria-hidden="true" />
                <h3 className="font-semibold">{t("workers")}</h3>
              </div>
              <span className="text-xs text-slate-500">{t("heartbeatWindow")}</span>
            </div>
            <div className="divide-y divide-border-soft">
              {([
                { key: "sync", label: t("syncWorker"), worker: operations.sync.worker },
                { key: "notifications", label: t("notificationWorker"), worker: operations.workers.notifications },
                { key: "backups", label: t("backupWorker"), worker: operations.workers.backups },
              ]).map(({ key, label, worker }) => (
                <article key={key} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3 first:pt-0 last:pb-0">
                  <div>
                    <h4 className="text-sm font-semibold">{label}</h4>
                    <p className="mt-1 text-xs text-slate-500">{worker.lastSeenAt ? t("workerLastSeen", { time: formatDate(worker.lastSeenAt, locale) }) : t("noWorkerHeartbeat")}</p>
                  </div>
                  <StatusBadge status={worker.status} label={displayStatus(worker.status)} />
                </article>
              ))}
            </div>
          </section>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(18rem,0.85fr)]">
          <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <ShieldCheck className="size-4 text-primary-600" aria-hidden="true" />
              <h3 className="font-semibold">{t("readinessDetails")}</h3>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ReadinessCard icon={Database} label={t("database")} status={operations.database.status} statusLabel={displayStatus(operations.database.status)} />
              <ReadinessCard icon={ShieldCheck} label={t("primaryDatabase")} status={operations.readiness.primaryDatabase.status} statusLabel={displayStatus(operations.readiness.primaryDatabase.status)} />
              <ReadinessCard icon={HardDrive} label={t("mediaStorage")} status={operations.media.status} statusLabel={displayStatus(operations.media.status)} supporting={operations.media.provider === "local" ? t("mediaProviders.local") : operations.media.provider === "r2" ? t("mediaProviders.r2") : undefined} />
              <ReadinessCard icon={Database} label={t("backupStorage")} status={operations.readiness.backup.status} statusLabel={displayStatus(operations.readiness.backup.status)} supporting={operations.readiness.backup.lastSuccessfulAt ? t("lastSuccessfulBackup", { time: formatDate(operations.readiness.backup.lastSuccessfulAt, locale) }) : undefined} />
            </div>
            {(activeDatabaseBlockers.length > 0 || activePrimaryBlockers.length > 0 || activeMediaBlockers.length > 0 || activeBackupBlockers.length > 0 || activeMediaWarnings.length > 0) && (
              <div className="mt-4 space-y-3">
                {renderBlockers(t("databaseBlockersTitle"), activeDatabaseBlockers)}
                {renderBlockers(t("primaryBlockersTitle"), activePrimaryBlockers)}
                {renderBlockers(t("mediaBlockersTitle"), activeMediaBlockers)}
                {activeMediaWarnings.length > 0 && <div role="note" className="rounded-xl border border-sky-200 bg-sky-50/70 p-4 text-sm text-sky-950 dark:border-sky-900 dark:bg-sky-950/25 dark:text-sky-100"><h4 className="font-semibold">{t("mediaWarnings.title")}</h4><ul className="mt-2 list-disc space-y-1 pl-5 leading-relaxed">{activeMediaWarnings.map((warning) => <li key={warning}>{warning}</li>)}</ul></div>}
                {renderBlockers(t("backupBlockersTitle"), activeBackupBlockers)}
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
            <div className="mb-4 flex items-center gap-2">
              <Clock3 className="size-4 text-primary-600" aria-hidden="true" />
              <h3 className="font-semibold">{t("queue")}</h3>
            </div>
            {Object.keys(operations.sync.queue).length === 0 ? <p className="rounded-xl bg-surface-2 p-4 text-sm text-slate-500">{t("emptySyncQueue")}</p> : (
              <dl className="divide-y divide-border-soft">
                {Object.entries(operations.sync.queue).sort(([left], [right]) => left.localeCompare(right)).map(([status, count]) => (
                  <div key={status} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
                    <dt className="text-sm text-slate-600 dark:text-slate-300">{displayStatus(status)}</dt>
                    <dd className="font-mono text-sm font-semibold tabular-nums">{new Intl.NumberFormat(locale === "vi" ? "vi-VN" : "en-US").format(count)}</dd>
                  </div>
                ))}
              </dl>
            )}
          </section>
        </div>

        <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
            <div>
              <div className="flex items-center gap-2"><HardDrive className="size-4 text-primary-600" aria-hidden="true" /><h3 className="font-semibold">{t("backup")}</h3></div>
              <p className="mt-1 max-w-2xl text-xs leading-5 text-slate-500">{t("backupDescription")}</p>
            </div>
            <button type="button" disabled={busy || hasActiveBackup} onClick={() => void requestBackup()} className="inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white transition hover:bg-primary-700 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50">
              {busy ? <RefreshCw className="size-4 animate-spin" /> : <HardDrive className="size-4" />}
              {hasActiveBackup ? t("backupInProgress") : busy ? t("backupRequesting") : t("requestBackup")}
            </button>
          </div>
          {operations.backups.length === 0 ? <div className="mt-4 rounded-xl bg-surface-2 px-4 py-6 text-center">
            <p className="text-sm font-semibold">{t("emptyBackupsTitle")}</p>
            <p className="mt-1 text-xs text-slate-500">{t("emptyBackupsDescription")}</p>
          </div> : <div className="mt-4 divide-y divide-border-soft border-t border-border-soft">
            {operations.backups.map((backup) => (
              <article key={backup.id} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <StatusBadge status={backup.status} label={displayStatus(backup.status)} />
                    <span className="text-xs font-medium text-slate-500">{backup.triggerType === "manual" ? t("manualTrigger") : t("automaticTrigger")}</span>
                  </div>
                  <dl className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-500">
                    <div><dt className="inline font-medium">{t("requestedAt")}: </dt><dd className="inline">{formatDate(backup.requestedAt, locale)}</dd></div>
                    {backup.startedAt && <div><dt className="inline font-medium">{t("startedAt")}: </dt><dd className="inline">{formatDate(backup.startedAt, locale)}</dd></div>}
                    {backup.finishedAt && <div><dt className="inline font-medium">{t("finishedAt")}: </dt><dd className="inline">{formatDate(backup.finishedAt, locale)}</dd></div>}
                  </dl>
                  {backup.archiveKey && <code className="mt-2 block break-all text-[11px] text-slate-500">{backup.archiveKey}</code>}
                  {backup.sha256 && <code className="mt-1 block break-all text-[11px] text-slate-500">SHA-256: {backup.sha256}</code>}
                  {backup.failureCode && <p className="mt-2 text-xs text-rose-700 dark:text-rose-300">{t("failureCode")}: <code>{backup.failureCode}</code></p>}
                </div>
                <p className="font-mono text-xs tabular-nums text-slate-500">{formatBytes(backup.archiveSizeBytes, locale)}</p>
              </article>
            ))}
          </div>}
        </section>
      </> : loading ? <div className="space-y-4" aria-label={t("loading")}><div className="h-40 animate-pulse rounded-2xl bg-surface-2" /><div className="h-64 animate-pulse rounded-2xl bg-surface-2" /></div> : null}
    </div>
  );
}
