import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CalendarCheck, ChevronLeft, MapPin } from "lucide-react";
import { getFieldServiceJobs } from "@/lib/data/service-field";
import { requireStoreContext } from "@/lib/auth/store-context";
import { requirePageFeature } from "@/lib/tenancy/page-feature";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";

const circle = "grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10";

/** NativeServiceJobsView: today / 7-day field schedule with one card per work order. */
export default async function ServiceJobsPage({ searchParams }: { searchParams: Promise<{ scope?: string }> }) {
  await requirePageFeature("field_services");
  const [t, tc, params, context] = await Promise.all([
    getTranslations("mobile.serviceJobs"),
    getTranslations(),
    searchParams,
    requireStoreContext(),
  ]);
  const scope = params.scope === "week" ? "week" : "today";
  const jobs = await getFieldServiceJobs({ actor: { userId: context.userId, role: context.role }, scope });

  return (
    <div className="flex min-h-dvh flex-col bg-surface">
      <header className="sticky top-0 z-20 bg-surface/85 px-ios-inset pb-2.5 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl">
        <div className="grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2">
          <Link href={Routes.More} aria-label={tc("common.back")} data-button-radius="pill" className={`${circle} text-ios-label`}>
            <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />
          </Link>
          <h1 className="truncate text-center text-[17px] font-semibold">{t("title")}</h1>
          <span aria-hidden="true" />
        </div>
        <nav aria-label={t("scopeLabel")} className="mx-auto mt-3 grid max-w-xl grid-cols-2 rounded-full bg-ios-accent/10 p-1">
          {(["today", "week"] as const).map((key) => (
            <Link
              key={key}
              href={key === "today" ? Routes.ServiceJobs : `${Routes.ServiceJobs}?scope=week`}
              replace
              scroll={false}
              aria-current={scope === key ? "page" : undefined}
              data-button-radius="pill"
              className={cn("grid min-h-10 place-items-center rounded-full text-[17px]", scope === key ? "bg-ios-accent font-semibold text-white" : "text-ios-label")}
            >
              {t(key)}
            </Link>
          ))}
        </nav>
      </header>

      {jobs.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 pb-24 text-center">
          <CalendarCheck className="size-9 text-ios-label-secondary" aria-hidden="true" />
          <p className="text-[17px] font-semibold">{t("emptyTitle")}</p>
          <p className="text-[15px] text-ios-label-secondary">{t("emptyMessage")}</p>
        </div>
      ) : (
        <div className="mx-auto w-full max-w-xl pb-6">
          {jobs.map((job) => {
            const checklist = Array.isArray(job.checklist) ? job.checklist : [];
            const done = checklist.filter((item) => item.completed).length;
            const progress = checklist.length ? done / checklist.length : 0;
            const tone = job.priority === "urgent" ? "text-ios-red bg-ios-red/12" : job.priority === "high" ? "text-ios-orange bg-ios-orange/12" : "text-ios-accent bg-ios-accent/12";
            const statusKey = `status.${job.status}`;
            return (
              <Link key={job.id} href={Routes.project(job.projectId)} className="relative block space-y-[11px] p-4 after:absolute after:inset-x-0 after:bottom-0 after:ml-4 after:h-px after:bg-border last:after:hidden active:bg-black/[0.04] dark:active:bg-white/[0.06]">
                <span className="flex items-center gap-2">
                  <span className={cn("rounded-full px-[9px] py-[5px] text-[12px] font-bold leading-none", tone)}>{job.code}</span>
                  <span className="ml-auto text-[12px] font-semibold text-ios-label-secondary">{t.has(statusKey as never) ? t(statusKey as never) : job.status}</span>
                </span>
                <span className="block space-y-[3px]">
                  <span className="block text-[17px] font-bold leading-[22px]">{job.title}</span>
                  <span className="block text-[15px] font-medium text-ios-label-secondary">{job.projectName}</span>
                </span>
                {job.address && (
                  <span className="flex items-start gap-1.5 text-[12px] text-ios-label-secondary">
                    <MapPin className="mt-px size-3.5 shrink-0" aria-hidden="true" />
                    <span className="line-clamp-2">{job.address}</span>
                  </span>
                )}
                <span className="block h-1 overflow-hidden rounded-full bg-black/[0.08] dark:bg-white/15" aria-hidden="true">
                  <span className="block h-full rounded-full bg-ios-accent" style={{ width: `${Math.round(progress * 100)}%` }} />
                </span>
                <span className="block text-[12px] text-ios-label-tertiary">{t("checklistProgress", { done, total: checklist.length })}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
