"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useLocale, useTranslations } from "next-intl";
import { ChevronDown, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";
import { canExtractFileMetadata, formatFileInfoBytes, formatSourceTimestamp, hasFileCoordinates } from "./file-info-utils";

export type FileInfoDetails = {
  metadata?: MediaFileMetadata | null;
  uploaderName?: string | null;
  canExtractMetadata?: boolean;
};

type FileInfoPanelProps = FileInfoDetails & {
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  uploadedAt: Date | string;
  canManage?: boolean;
  onLoad?: (signal: AbortSignal) => Promise<FileInfoDetails>;
  onExtract?: (signal: AbortSignal) => Promise<MediaFileMetadata | null>;
};

/** One disclosure for original-file facts, shared by the library and project viewers. */
export function FileInfoPanel({ fileName, mimeType, sizeBytes, uploadedAt, uploaderName,
  metadata, canManage = false, canExtractMetadata, onLoad, onExtract }: FileInfoPanelProps) {
  const t = useTranslations("fileInfo");
  const locale = useLocale();
  const [loaded, setLoaded] = useState<FileInfoDetails | null>(null);
  const [extracted, setExtracted] = useState<MediaFileMetadata | null | undefined>(undefined);
  const [loadState, setLoadState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [extracting, setExtracting] = useState(false);
  const [extractError, setExtractError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => request.current?.abort(), []);
  const currentMetadata = extracted !== undefined ? extracted : loaded ? loaded.metadata : metadata;
  const currentUploader = loaded?.uploaderName ?? uploaderName;
  const canExtract = loaded?.canExtractMetadata ?? canExtractMetadata ?? canManage;
  const uploadTimestamp = typeof uploadedAt === "string" ? uploadedAt : uploadedAt.toISOString();
  const timestamp = formatSourceTimestamp(uploadTimestamp, locale);

  async function load() {
    if (!onLoad || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setLoadState("loading");
    try {
      const next = await onLoad(controller.signal);
      if (!controller.signal.aborted) { setLoaded(next); setLoadState("ready"); }
    } catch {
      if (!controller.signal.aborted) setLoadState("error");
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  async function extract() {
    if (!onExtract || !canExtract || request.current) return;
    const controller = new AbortController();
    request.current = controller;
    setExtracting(true);
    setExtractError(false);
    try {
      const next = await onExtract(controller.signal);
      if (!controller.signal.aborted) setExtracted(next);
    } catch {
      if (!controller.signal.aborted) setExtractError(true);
    } finally {
      if (request.current === controller) request.current = null;
      if (!controller.signal.aborted) setExtracting(false);
    }
  }

  return (
    <details className="group min-w-0 border-t border-border" onToggle={(event) => {
      if (event.currentTarget.open && onLoad && loadState === "idle") void load();
    }}>
      <summary tabIndex={0} className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-md py-3 text-sm font-semibold text-slate-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600 dark:text-slate-200 [&::-webkit-details-marker]:hidden">
        <Info aria-hidden="true" className="h-4 w-4 shrink-0 text-slate-500" />
        {t("title")}
        <ChevronDown aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 transition-transform group-open:rotate-180" />
      </summary>
      <div className="space-y-4 pb-4 text-xs" aria-busy={loadState === "loading" || extracting}>
        <section aria-label={t("storedFile")}>
          <h3 className="mb-2 font-semibold text-slate-500">{t("storedFile")}</h3>
          <dl className="space-y-2.5">
            <InfoRow label={t("fileName")}>{fileName}</InfoRow>
            <InfoRow label={t("mimeType")}>{mimeType}</InfoRow>
            <InfoRow label={t("size")}>{formatFileInfoBytes(sizeBytes, locale)}</InfoRow>
            <InfoRow label={t("uploadedAt")}>{timestamp ? `${timestamp.text}${timestamp.timezone ? ` · ${timestamp.timezone}` : ""}` : t("unknown")}</InfoRow>
            <InfoRow label={t("uploader")}>{currentUploader || t("unknown")}</InfoRow>
          </dl>
        </section>
        <section className="border-t border-border pt-3" aria-label={t("originalMetadata")}>
          <h3 className="mb-2 font-semibold text-slate-500">{t("originalMetadata")}</h3>
          {loadState === "loading" ? <p role="status" className="text-slate-500">{t("loading")}</p>
            : loadState === "error" ? <div role="alert"><p className="text-er">{t("loadError")}</p><Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void load()}>{t("retry")}</Button></div>
              : <>
                <FileMetadataRows metadata={currentMetadata} />
                {canExtract && onExtract && (!onLoad || loadState === "ready") && canExtractFileMetadata(currentMetadata) && (
                  <Button type="button" variant="outline" size="sm" className="mt-3 w-full whitespace-normal" loading={extracting} onClick={() => void extract()}>
                    {t(extracting ? "extracting" : extractError || currentMetadata?.status === "failed" ? "retryExtract" : "extract")}
                  </Button>
                )}
                {extracting && <p role="status" className="sr-only">{t("extracting")}</p>}
                {extractError && <p role="alert" className="mt-2 text-er">{t("extractError")}</p>}
              </>}
          <p className="mt-3 leading-5 text-slate-500">{t("sourceHint")}</p>
        </section>
      </div>
    </details>
  );
}

export function FileMetadataRows({ metadata }: { metadata?: MediaFileMetadata | null }) {
  const t = useTranslations("fileInfo");
  const locale = useLocale();
  if (!metadata || metadata.status !== "ready") {
    return <p role="status" className={metadata?.status === "failed" ? "leading-5 text-er" : "leading-5 text-slate-500"}>{t(`statuses.${metadata?.status ?? "missing"}`)}</p>;
  }
  const number = (value: number, maximumFractionDigits = 3) => new Intl.NumberFormat(locale, { maximumFractionDigits }).format(value);
  const rows: { key: string; label: string; value: ReactNode }[] = [];
  const add = (key: string, value: ReactNode) => rows.push({ key, label: t(key), value });
  for (const key of ["capturedAt", "fileCreatedAt", "fileModifiedAt"] as const) {
    const date = formatSourceTimestamp(metadata[key], locale);
    if (date) add(key, <>{date.text}<span className="mt-0.5 block text-[11px] text-slate-500">{date.timezone ?? t("timezoneUnknown")}</span></>);
    else if (key === "capturedAt") add(key, t("notInFile"));
  }
  if (hasFileCoordinates(metadata)) {
    add("coordinates", `${number(metadata.latitude!, 6)}, ${number(metadata.longitude!, 6)}`);
  } else {
    add("coordinates", t("notInFile"));
  }
  for (const key of ["make", "model", "lens", "software", "format", "videoCodec", "audioCodec"] as const) {
    if (metadata[key]?.trim()) add(key, metadata[key]);
  }
  if (Number.isFinite(metadata.width) && Number.isFinite(metadata.height) && metadata.width! > 0 && metadata.height! > 0) {
    add("dimensions", `${number(metadata.width!, 0)} × ${number(metadata.height!, 0)} px`);
  }
  for (const [key, unit] of [["altitude", "meters"], ["durationSeconds", "seconds"], ["frameRate", "fps"], ["exposureTime", "seconds"], ["focalLength", "millimeters"]] as const) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) add(key, t(unit, { value: number(value, key === "exposureTime" ? 6 : 3) }));
  }
  for (const key of ["orientation", "iso", "fNumber"] as const) {
    const value = metadata[key];
    if (typeof value === "number" && Number.isFinite(value)) add(key, `${key === "fNumber" ? "f/" : ""}${number(value)}`);
  }
  if (rows.length === 0) return <p role="status" className="leading-5 text-slate-500">{t("statuses.empty")}</p>;
  return <dl className="space-y-2.5">{rows.map((row) => <InfoRow key={row.key} label={row.label}>{row.value}</InfoRow>)}</dl>;
}

function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return <div className="min-w-0"><dt className="text-[11px] text-slate-500">{label}</dt><dd className="mt-0.5 min-w-0 break-all leading-5 text-slate-700 dark:text-slate-200">{children}</dd></div>;
}
