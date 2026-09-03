"use client";

import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";

export function ServiceRequestForm({
  token,
  initialStatus,
  canSubmit,
}: {
  token: string;
  initialStatus: {
    code: string | null;
    title: string | null;
    priority: string | null;
    status: string;
    submittedAt: string | null;
    responseDueAt: string | null;
    resolutionDueAt: string | null;
    respondedAt: string | null;
    resolvedAt: string | null;
  };
  canSubmit: boolean;
}) {
  const t = useTranslations("serviceRequestPortal");
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const locale = useLocale();
  const [sent, setSent] = useState(!canSubmit);
  const [statusView, setStatusView] = useState(initialStatus);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  if (sent) {
    return (
      <div className="mt-6 space-y-3 rounded-2xl bg-emerald-50 p-5 text-sm text-emerald-900">
        <p className="font-bold">{t("received")}</p>
        <dl className="grid gap-2 sm:grid-cols-2">
          <div><dt className="text-xs font-semibold uppercase text-emerald-700">{t("status")}</dt><dd className="font-semibold">{statusView.status}</dd></div>
          {statusView.title && <div><dt className="text-xs font-semibold uppercase text-emerald-700">{t("request")}</dt><dd className="font-semibold">{statusView.title}</dd></div>}
          {statusView.responseDueAt && <div><dt className="text-xs font-semibold uppercase text-emerald-700">{t("estimatedResponse")}</dt><dd>{new Date(statusView.responseDueAt).toLocaleString(locale)}</dd></div>}
          {statusView.resolutionDueAt && <div><dt className="text-xs font-semibold uppercase text-emerald-700">{t("estimatedResolution")}</dt><dd>{new Date(statusView.resolutionDueAt).toLocaleString(locale)}</dd></div>}
        </dl>
        <p>{t("followUp")}</p>
      </div>
    );
  }

  return (
    <form
      className="mt-6 space-y-4"
      onSubmit={async (event) => {
        event.preventDefault();
        setBusy(true);
        setError("");
        const form = new FormData(event.currentTarget);
        const files = form.getAll("evidence").filter((value): value is File =>
          value instanceof File && value.size > 0);
        if (files.length > 3) {
          setBusy(false);
          setError(t("maxFiles"));
          return;
        }
        const response = await fetch(`/api/portal/service-request/${token}`, {
          method: "POST",
          body: form,
        });
        setBusy(false);
        if (response.ok) {
          const body = await response.json() as {
            data?: {
              status?: string;
              responseDueAt?: string | null;
              resolutionDueAt?: string | null;
            };
          };
          setStatusView((current) => ({
            ...current,
            title: String(form.get("title") ?? ""),
            priority: String(form.get("priority") ?? "normal"),
            status: body.data?.status ?? "new",
            submittedAt: new Date().toISOString(),
            responseDueAt: body.data?.responseDueAt ?? null,
            resolutionDueAt: body.data?.resolutionDueAt ?? null,
          }));
          setSent(true);
        } else setError(t("submitFailed"));
      }}
    >
      <label className="block text-sm font-semibold">
        {t("subject")}
        <input name="title" required minLength={3} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
      </label>
      <div className="block text-sm font-semibold">
        <span>{t("evidence")}</span>
        <input
          ref={fileRef}
          name="evidence"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={(event) => setFileNames(Array.from(event.target.files ?? []).map((file) => file.name))}
        />
        <Button type="button" variant="outline" className="mt-1 w-full justify-start" onClick={() => fileRef.current?.click()}>
          <span className="min-w-0 truncate" title={fileNames.length ? fileNames.join(", ") : undefined}>
            {fileNames.length ? fileNames.join(", ") : locale.startsWith("vi") ? "Chọn ảnh" : "Choose images"}
          </span>
        </Button>
      </div>
      <label className="block text-sm font-semibold">
        {t("description")}
        <textarea name="description" required minLength={5} rows={5} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
      </label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm font-semibold">
          {t("contactName")}
          <input name="contactName" required autoComplete="name" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
        </label>
        <label className="block text-sm font-semibold">
          {t("phone")}
          <input name="contactPhone" required autoComplete="tel" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2" />
        </label>
      </div>
      <label className="block text-sm font-semibold">
        {t("priority")}
        <Select name="priority" defaultValue="normal" aria-label={t("priority")} rootClassName="mt-1 w-full"
          options={["low", "normal", "high", "urgent"].map((value) => ({ value, label: t(`priorities.${value}`) }))} />
      </label>
      {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
      <button disabled={busy} className="w-full rounded-xl bg-blue-600 px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
        {busy ? t("sending") : t("submit")}
      </button>
    </form>
  );
}
