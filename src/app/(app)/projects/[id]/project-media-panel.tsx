"use client";

import NextImage from "next/image";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type Dispatch,
  type ReactNode,
  type SetStateAction,
} from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import {
  Camera,
  Check,
  ChevronDown,
  Download,
  FileText,
  Image as ImageIcon,
  LoaderCircle,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";

import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { RowPreviewModal } from "@/components/data-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/ui/label";
import { SegmentedTabs } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { MediaFileMetadata } from "@/lib/media/file-metadata-types";
import { ProjectImageViewport } from "./project-image-viewport";
import { ProjectFileInfo } from "./project-file-info";

export type ProjectMediaKind = "photos" | "documents";
export function filterProjectMediaKind(items: readonly ProjectMediaItem[], kind: ProjectMediaKind) {
  return items.filter((item) => item.mimeType.toLowerCase().startsWith("image/") === (kind === "photos"));
}

export const PROJECT_MEDIA_PHASES = [
  ["survey", "Khảo sát"],
  ["construction", "Thi công"],
  ["after_installation", "Sau lắp đặt"],
  ["acceptance", "Nghiệm thu"],
  ["handover", "Bàn giao"],
  ["other", "Khác"],
] as const;

export type ProjectMediaPhase = (typeof PROJECT_MEDIA_PHASES)[number][0];

export type ProjectMediaItem = {
  id: string;
  mediaId: string;
  phase: ProjectMediaPhase;
  caption: string | null;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: Date | string;
  signedUrl?: string;
  documentIds?: string[];
  metadata?: MediaFileMetadata | null;
  creatorName?: string | null;
};

export type ProjectMediaOpenUploadSignal = {
  sequence: number;
  phase?: ProjectMediaPhase;
  documentId?: string | null;
};

export type ProjectMediaUploadContext = {
  phase: ProjectMediaPhase;
  caption?: string;
  documentId?: string | null;
};

type PhasePickerOption = {
  value: string;
  label: string;
};

type ProjectMediaListState = "loading" | "ready" | "error";
type ProjectMediaUploadStatus = "queued" | "uploading" | "complete" | "failed";

export type ProjectMediaUploadErrorCategory =
  | "network"
  | "timeout"
  | "rate_limit"
  | "server"
  | "validation"
  | "conflict"
  | "expired"
  | "auth"
  | "not_found"
  | "invalid_response";

export type ProjectMediaPendingFile = {
  localId: string;
  file: File;
  uploadContext?: ProjectMediaUploadContext;
};

export type ProjectMediaUploadResult = {
  localId: string;
  status: "complete" | "failed";
  item?: ProjectMediaItem;
  error?: string;
  retryable: boolean;
  httpStatus: number | null;
  errorCategory: ProjectMediaUploadErrorCategory | null;
};

type ProjectMediaQueueItem = ProjectMediaPendingFile & {
  status: ProjectMediaUploadStatus;
  progress: number;
  item?: ProjectMediaItem;
  error?: string;
  retryable?: boolean;
  httpStatus: number | null;
  errorCategory: ProjectMediaUploadErrorCategory | null;
};

type UploadStatusPatch = {
  status: ProjectMediaUploadStatus;
  progress: number;
  item?: ProjectMediaItem;
  error?: string;
  retryable?: boolean;
  httpStatus: number | null;
  errorCategory: ProjectMediaUploadErrorCategory | null;
};

export const PROJECT_MEDIA_UPLOAD_CONCURRENCY = 3;
const PROJECT_MEDIA_MAX_BYTES = 25 * 1024 * 1024;
const PROJECT_MEDIA_ACCEPT = [
  "image/avif",
  "image/gif",
  "image/heic",
  "image/heif",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
].join(",");
const PROJECT_MEDIA_FOCUSABLE = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

export function isRetryableProjectMediaUploadStatus(status: number) {
  return isRetryableProjectMediaUploadErrorCategory(
    projectMediaUploadErrorCategoryForStatus(status),
  );
}

export function projectMediaUploadErrorCategoryForStatus(
  status: number,
): ProjectMediaUploadErrorCategory {
  if (status === 408) return "timeout";
  if (status === 429) return "rate_limit";
  if (status >= 500) return "server";
  if (status === 401 || status === 403) return "auth";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 410) return "expired";
  if (status >= 400) return "validation";
  return "invalid_response";
}

export function isRetryableProjectMediaUploadErrorCategory(
  category: ProjectMediaUploadErrorCategory,
) {
  return category === "network"
    || category === "timeout"
    || category === "rate_limit"
    || category === "server";
}

export function projectMediaUploadErrorMessageKey(
  category: ProjectMediaUploadErrorCategory,
) {
  if (category === "validation") return "uploadValidation" as const;
  if (category === "conflict") return "uploadConflict" as const;
  if (category === "expired") return "uploadExpired" as const;
  if (category === "auth") return "uploadAuth" as const;
  if (category === "not_found") return "uploadNotFound" as const;
  if (category === "invalid_response") return "uploadInvalidResponse" as const;
  return "uploadError" as const;
}

export function filterProjectMediaItems(
  items: readonly ProjectMediaItem[],
  phaseFilter?: readonly ProjectMediaPhase[],
  selectedPhase?: ProjectMediaPhase,
) {
  return items.filter((item) => (
    (!phaseFilter || phaseFilter.includes(item.phase))
    && (!selectedPhase || item.phase === selectedPhase)
  ));
}

export function mergeProjectMediaItems(
  current: readonly ProjectMediaItem[],
  incoming: readonly ProjectMediaItem[],
) {
  const currentById = new Map(current.map((item) => [item.id, item]));
  const merged: ProjectMediaItem[] = incoming.map((item) => {
    const previous = currentById.get(item.id);
    return {
      ...previous,
      ...item,
      documentIds: item.documentIds ?? previous?.documentIds ?? [],
    };
  });
  return merged;
}

export function nextProjectMediaPickerState(
  state: { open: boolean; activeIndex: number },
  key: string,
  optionCount: number,
) {
  if (optionCount <= 0) {
    return { ...state, select: false };
  }
  if (key === "Escape") {
    return { ...state, open: false, select: false };
  }
  if (key === "Tab") {
    return { ...state, open: false, select: false };
  }
  if (key === "ArrowDown") {
    return {
      open: true,
      activeIndex: (state.activeIndex + 1 + optionCount) % optionCount,
      select: false,
    };
  }
  if (key === "ArrowUp") {
    return {
      open: true,
      activeIndex: (state.activeIndex - 1 + optionCount) % optionCount,
      select: false,
    };
  }
  if ((key === "Enter" || key === " ") && state.open) {
    return { ...state, open: false, select: true };
  }
  if ((key === "Enter" || key === " ") && !state.open) {
    return { ...state, open: true, select: false };
  }
  return { ...state, select: false };
}

export function shouldDismissProjectMediaPicker(
  root: Pick<HTMLElement, "contains"> | null,
  target: Node,
) {
  return Boolean(root && !root.contains(target));
}

export function projectMediaPickerTabTarget(
  focusables: readonly HTMLElement[],
  root: Pick<HTMLElement, "contains"> | null,
  trigger: HTMLElement | null,
  shiftKey: boolean,
) {
  if (!root || !trigger) return null;
  const triggerIndex = focusables.indexOf(trigger);
  if (triggerIndex < 0) return null;
  const step = shiftKey ? -1 : 1;
  for (
    let index = triggerIndex + step;
    index >= 0 && index < focusables.length;
    index += step
  ) {
    const candidate = focusables[index];
    if (!root.contains(candidate)) return candidate;
  }
  return null;
}

export function moveProjectMediaPickerTabFocus(
  focusables: readonly HTMLElement[],
  root: Pick<HTMLElement, "contains"> | null,
  trigger: HTMLElement | null,
  shiftKey: boolean,
) {
  const target = projectMediaPickerTabTarget(focusables, root, trigger, shiftKey);
  if (!target) return false;
  target.focus();
  return true;
}

export function projectMediaDownloadUrl(projectId: string, attachmentId: string) {
  const params = new URLSearchParams({ attachmentId, download: "1" });
  return `/api/mobile/services/projects/${encodeURIComponent(projectId)}/attachments?${params.toString()}`;
}

export function navigateProjectMediaPreview(
  preview: { location: { href: string } } | null,
  signedUrl: string,
  navigateCurrent: (url: string) => void = (url) => window.location.assign(url),
) {
  if (preview) {
    preview.location.href = signedUrl;
    return "preview" as const;
  }
  navigateCurrent(signedUrl);
  return "current" as const;
}

export function canCommitProjectMediaRequest(input: {
  aborted: boolean;
  requestSequence: number;
  latestRequestSequence: number;
  mutationRevision: number;
  currentMutationRevision: number;
}) {
  return !input.aborted
    && input.requestSequence === input.latestRequestSequence
    && input.mutationRevision === input.currentMutationRevision;
}

export function suspendParentProjectMediaDialog(panel: Element | null) {
  const parentDialog = panel?.closest('[role="dialog"][aria-modal="true"]');
  if (!parentDialog) return () => undefined;
  const previous = {
    ariaModal: parentDialog.getAttribute("aria-modal"),
    ariaHidden: parentDialog.getAttribute("aria-hidden"),
    inert: parentDialog.getAttribute("inert"),
  };
  parentDialog.setAttribute("aria-modal", "false");
  parentDialog.setAttribute("aria-hidden", "true");
  parentDialog.setAttribute("inert", "");
  return () => {
    restoreAttribute(parentDialog, "aria-modal", previous.ariaModal);
    restoreAttribute(parentDialog, "aria-hidden", previous.ariaHidden);
    restoreAttribute(parentDialog, "inert", previous.inert);
  };
}

export function projectMediaModalFocusTarget(
  focusables: readonly HTMLElement[],
  activeElement: Element | null,
  shiftKey: boolean,
) {
  if (focusables.length === 0) return null;
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (!focusables.includes(activeElement as HTMLElement)) return first;
  if (shiftKey && activeElement === first) return last;
  if (!shiftKey && activeElement === last) return first;
  return null;
}

export function snapshotProjectMediaUploadTargets(
  files: readonly ProjectMediaPendingFile[],
  context: ProjectMediaUploadContext,
) {
  return files.map((pending) => ({
    ...pending,
    uploadContext: pending.uploadContext ?? context,
  }));
}

export async function uploadProjectMediaFiles({
  projectId,
  files,
  phase,
  caption,
  documentId,
  fetcher = fetch,
  onStatus,
}: {
  projectId: string;
  files: readonly ProjectMediaPendingFile[];
  phase: ProjectMediaPhase;
  caption?: string;
  documentId?: string | null;
  fetcher?: typeof fetch;
  onStatus?: (localId: string, patch: UploadStatusPatch) => void;
}): Promise<ProjectMediaUploadResult[]> {
  if (files.length === 0) return [];
  const results = new Array<ProjectMediaUploadResult>(files.length);
  let cursor = 0;

  async function worker() {
    while (cursor < files.length) {
      const index = cursor;
      cursor += 1;
      const pending = files[index];
      const requestContext = pending.uploadContext ?? { phase, caption, documentId };
      onStatus?.(pending.localId, {
        status: "uploading",
        progress: 12,
        httpStatus: null,
        errorCategory: null,
      });
      const form = new FormData();
      form.set("file", pending.file);
      form.set("phase", requestContext.phase);
      form.set("idempotencyKey", pending.localId);
      if (requestContext.caption?.trim()) form.set("caption", requestContext.caption.trim());
      if (requestContext.documentId) form.set("documentId", requestContext.documentId);
      let retryable = true;
      let httpStatus: number | null = null;
      let errorCategory: ProjectMediaUploadErrorCategory = "network";
      try {
        const response = await fetcher(
          `/api/mobile/services/projects/${encodeURIComponent(projectId)}/attachments`,
          { method: "POST", body: form },
        );
        httpStatus = response.status;
        onStatus?.(pending.localId, {
          status: "uploading",
          progress: 78,
          httpStatus,
          errorCategory: null,
        });
        const body = await readProjectMediaResponse(response);
        if (!response.ok) {
          errorCategory = projectMediaUploadErrorCategoryForStatus(response.status);
          retryable = isRetryableProjectMediaUploadErrorCategory(errorCategory);
          throw new Error(body.error ?? "PROJECT_MEDIA_UPLOAD_FAILED");
        }
        if (!body.data || Array.isArray(body.data)) {
          errorCategory = "invalid_response";
          retryable = false;
          throw new Error(body.error ?? "PROJECT_MEDIA_UPLOAD_FAILED");
        }
        const item: ProjectMediaItem = {
          ...body.data,
          documentIds: requestContext.documentId
            ? [requestContext.documentId]
            : body.data.documentIds ?? [],
        };
        results[index] = {
          localId: pending.localId,
          status: "complete",
          item,
          retryable: false,
          httpStatus,
          errorCategory: null,
        };
        onStatus?.(pending.localId, {
          status: "complete",
          progress: 100,
          item,
          retryable: false,
          httpStatus,
          errorCategory: null,
        });
      } catch (error) {
        const message = error instanceof Error
          ? error.message
          : "PROJECT_MEDIA_UPLOAD_FAILED";
        results[index] = {
          localId: pending.localId,
          status: "failed",
          error: message,
          retryable,
          httpStatus,
          errorCategory,
        };
        onStatus?.(pending.localId, {
          status: "failed",
          progress: 0,
          error: message,
          retryable,
          httpStatus,
          errorCategory,
        });
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(PROJECT_MEDIA_UPLOAD_CONCURRENCY, files.length) },
      () => worker(),
    ),
  );
  return results;
}

export function failedProjectMediaUploads(
  files: readonly ProjectMediaPendingFile[],
  results: readonly ProjectMediaUploadResult[],
) {
  const failed = new Set(
    results
      .filter((result) => result.status === "failed" && result.retryable)
      .map((result) => result.localId),
  );
  return files.filter((file) => failed.has(file.localId));
}

export function retryableProjectMediaUploadCount(
  items: readonly { status: ProjectMediaUploadStatus; retryable?: boolean }[],
) {
  return items.filter((item) => item.status === "failed" && item.retryable).length;
}

export async function deleteProjectMediaItem({
  projectId,
  attachmentId,
  confirm,
  fetcher = fetch,
}: {
  projectId: string;
  attachmentId: string;
  confirm: () => Promise<boolean>;
  fetcher?: typeof fetch;
}) {
  if (!await confirm()) return false;
  const response = await fetcher(
    `/api/mobile/services/projects/${encodeURIComponent(projectId)}/attachments?attachmentId=${encodeURIComponent(attachmentId)}`,
    { method: "DELETE" },
  );
  if (!response.ok) {
    const body = await readProjectMediaResponse(response);
    throw new Error(body.error ?? "PROJECT_MEDIA_DELETE_FAILED");
  }
  return true;
}

export function ProjectMediaPhasePicker({
  label,
  value,
  onChange,
  options,
  defaultOpen = false,
  disabled = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options?: readonly PhasePickerOption[];
  defaultOpen?: boolean;
  disabled?: boolean;
}) {
  const t = useTranslations("projectMedia");
  const fallbackOptions = useProjectMediaPhaseOptions();
  const resolvedOptions = options ?? fallbackOptions;
  const selectedIndex = Math.max(0, resolvedOptions.findIndex((option) => option.value === value));
  const [open, setOpen] = useState(defaultOpen);
  const [activeIndex, setActiveIndex] = useState(selectedIndex);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = `project-media-picker-${useId().replaceAll(":", "")}`;
  const selected = resolvedOptions[selectedIndex];

  useEffect(() => {
    if (!open) return;
    optionRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent) {
      if (shouldDismissProjectMediaPicker(rootRef.current, event.target as Node)) {
        setOpen(false);
      }
    }
    function onEscape(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      triggerRef.current?.focus();
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onEscape, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onEscape, true);
    };
  }, [open]);

  function handleKeyDown(event: ReactKeyboardEvent) {
    if (!["ArrowDown", "ArrowUp", "Enter", " ", "Escape", "Tab"].includes(event.key)) return;
    if (event.key === "Tab") {
      const focusables = Array.from(
        document.querySelectorAll<HTMLElement>(PROJECT_MEDIA_FOCUSABLE),
      ).filter((element) => (
        element.tabIndex >= 0
        && element.getClientRects().length > 0
        && !element.closest("[inert]")
      ));
      const moved = moveProjectMediaPickerTabFocus(
        focusables,
        rootRef.current,
        triggerRef.current,
        event.shiftKey,
      );
      setOpen(false);
      if (moved) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const next = nextProjectMediaPickerState(
      { open, activeIndex },
      event.key,
      resolvedOptions.length,
    );
    setOpen(next.open);
    setActiveIndex(next.activeIndex);
    if (next.select) {
      const option = resolvedOptions[next.activeIndex];
      if (option) onChange(option.value);
      triggerRef.current?.focus();
    }
  }

  function select(option: PhasePickerOption, index: number) {
    setActiveIndex(index);
    onChange(option.value);
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        disabled={disabled}
        onClick={() => {
          setActiveIndex(selectedIndex);
          setOpen((current) => !current);
        }}
        onKeyDown={handleKeyDown}
        className="relative flex h-11 w-full min-w-44 items-center rounded-lg border border-border bg-surface px-3 pr-9 text-left text-sm font-medium text-slate-700 transition-colors hover:border-primary-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <span className="sr-only">{label}: </span>
        <span className="truncate">{selected?.label ?? t("phasePlaceholder")}</span>
        <ChevronDown
          aria-hidden="true"
          className={cn(
            "absolute right-3 h-4 w-4 text-slate-400 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>
      {open && !disabled && (
        <div
          id={listboxId}
          role="listbox"
          aria-label={label}
          onKeyDown={handleKeyDown}
          className="absolute left-0 top-full z-[115] mt-1 max-h-72 min-w-full overflow-y-auto rounded-xl border border-border bg-surface p-1.5 shadow-e2"
        >
          {resolvedOptions.map((option, index) => {
            const selectedOption = option.value === value;
            const focused = index === activeIndex;
            return (
              <button
                key={option.value}
                ref={(element) => { optionRefs.current[index] = element; }}
                type="button"
                role="option"
                aria-selected={selectedOption}
                tabIndex={focused ? 0 : -1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => select(option, index)}
                className={cn(
                  "flex min-h-11 w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500",
                  selectedOption && "bg-primary-50 font-semibold text-primary-700",
                  focused && !selectedOption && "bg-surface-2 text-slate-900",
                )}
              >
                <span>{option.label}</span>
                {selectedOption && <Check aria-hidden="true" className="h-4 w-4" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export function ProjectMediaListView({
  state,
  items,
  error,
  onRetry,
  onOpen,
  onDownload,
  onDelete,
  busyIds,
  kind,
}: {
  state: ProjectMediaListState;
  items: readonly ProjectMediaItem[];
  error?: string;
  onRetry?: () => void;
  onOpen?: (item: ProjectMediaItem) => void;
  onDownload?: (item: ProjectMediaItem) => void;
  onDelete?: (item: ProjectMediaItem) => void;
  busyIds?: ReadonlySet<string>;
  kind?: ProjectMediaKind;
}) {
  const t = useTranslations("projectMedia");
  const locale = useLocale();

  if (state === "loading") {
    return (
      <div role="status" aria-busy="true" aria-label={t("loadingLabel")} className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {[0, 1, 2].map((index) => (
          <div key={index} className="aspect-square animate-pulse rounded-xl border border-border-soft bg-surface-2" />
        ))}
      </div>
    );
  }
  if (state === "error") {
    return (
      <div role="alert" className="rounded-xl border border-red-200 bg-red-50 px-4 py-6 text-center dark:border-red-900 dark:bg-red-950/30">
        <p className="text-sm font-semibold text-er">{error ?? t("loadError")}</p>
        {onRetry && <Button type="button" variant="outline" size="sm" className="mt-3" onClick={onRetry}>{t("retry")}</Button>}
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
        {kind === "documents" ? <FileText aria-hidden="true" className="mx-auto h-7 w-7 text-slate-400" /> : <ImageIcon aria-hidden="true" className="mx-auto h-7 w-7 text-slate-400" />}
        <p className="mt-3 text-sm text-slate-500">{t(kind ? kind === "photos" ? "emptyPhotos" : "emptyDocuments" : "empty")}</p>
      </div>
    );
  }

  return (
    <div data-testid="project-media-grid" className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
      {items.map((item) => {
        const image = item.mimeType.toLowerCase().startsWith("image/");
        const busy = busyIds?.has(item.id) ?? false;
        return (
          <article
            key={item.id}
            data-attachment-id={item.id}
            data-media-id={item.mediaId}
            className="group flex flex-col overflow-hidden rounded-xl border border-border-soft bg-surface transition-shadow hover:shadow-sm"
          >
            <button type="button" disabled={busy} onClick={() => onOpen?.(item)}
              aria-label={t("openFile", { fileName: item.fileName })}
              className="relative flex aspect-square w-full items-center justify-center overflow-hidden bg-surface-2 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary-500 disabled:opacity-50">
              {image && item.signedUrl ? (
                <NextImage
                  src={item.signedUrl}
                  alt={item.caption || item.fileName}
                  width={480}
                  height={480}
                  className="h-full w-full object-cover"
                  unoptimized
                />
              ) : image ? (
                <ImageIcon aria-hidden="true" className="h-9 w-9 text-slate-400" />
              ) : (
                <span className="flex flex-col items-center gap-2 text-primary-600"><FileText aria-hidden="true" className="h-9 w-9" /><span className="text-xs font-semibold">{item.fileName.split(".").pop()?.toUpperCase()}</span></span>
              )}
              <span className="absolute left-2 top-2 rounded-full bg-surface/95 px-2 py-1 text-[11px] font-semibold text-slate-700 shadow-sm">
                {t(`phases.${item.phase}`)}
              </span>
              {busy && <span role="status" className="absolute inset-0 grid place-items-center bg-surface/60"><LoaderCircle aria-label={t("loadingLabel")} className="h-5 w-5 animate-spin" /></span>}
            </button>
            <div className="flex flex-1 flex-col p-3">
              <h3 className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100" title={item.fileName}>{item.fileName}</h3>
              {item.caption && <p className="mt-1 line-clamp-2 text-xs text-slate-500">{item.caption}</p>}
              <p className="mt-2 mb-3 text-[11px] text-slate-400">
                {formatProjectMediaBytes(item.sizeBytes)} · {new Intl.DateTimeFormat(locale, { dateStyle: "short" }).format(new Date(item.createdAt))}
              </p>
              {(item.documentIds?.length ?? 0) > 0 && (
                <p className="mt-1 text-[11px] font-medium text-primary-700">
                  {t("linkedRecords", { count: item.documentIds?.length ?? 0 })}
                </p>
              )}
              <div className="mt-auto flex items-center justify-end gap-1 border-t border-border-soft pt-2">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDownload?.(item)}
                  aria-label={t("downloadFile", { fileName: item.fileName })}
                  className="grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-surface-2 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50 lg:h-9 lg:w-9"
                >
                  <Download aria-hidden="true" className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => onDelete?.(item)}
                  aria-label={t("deleteFile", { fileName: item.fileName })}
                  className="grid h-11 w-11 place-items-center rounded-lg text-slate-500 hover:bg-red-50 hover:text-er focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500 disabled:opacity-50 lg:h-9 lg:w-9"
                >
                  <Trash2 aria-hidden="true" className="h-4 w-4" />
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

type ProjectMediaRequestCoordinator = {
  mutationRevision: { current: number };
  requestSequence: { current: number };
  activeRequest: { current: AbortController | null };
};

type ProjectMediaRequestSnapshot = {
  controller: AbortController;
  requestSequence: number;
  mutationRevision: number;
};

function beginProjectMediaRequest(
  coordinator: ProjectMediaRequestCoordinator,
): ProjectMediaRequestSnapshot {
  coordinator.activeRequest.current?.abort();
  const controller = new AbortController();
  coordinator.requestSequence.current += 1;
  coordinator.activeRequest.current = controller;
  return {
    controller,
    requestSequence: coordinator.requestSequence.current,
    mutationRevision: coordinator.mutationRevision.current,
  };
}

function isCurrentProjectMediaRequest(
  coordinator: ProjectMediaRequestCoordinator,
  snapshot: ProjectMediaRequestSnapshot,
) {
  return canCommitProjectMediaRequest({
    aborted: snapshot.controller.signal.aborted,
    requestSequence: snapshot.requestSequence,
    latestRequestSequence: coordinator.requestSequence.current,
    mutationRevision: snapshot.mutationRevision,
    currentMutationRevision: coordinator.mutationRevision.current,
  });
}

function finishProjectMediaRequest(
  coordinator: ProjectMediaRequestCoordinator,
  snapshot: ProjectMediaRequestSnapshot,
) {
  if (coordinator.activeRequest.current === snapshot.controller) {
    coordinator.activeRequest.current = null;
  }
}

type ProjectMediaPanelProps = {
  projectId: string;
  canManage?: boolean;
  phaseFilter?: readonly ProjectMediaPhase[];
  initialItems?: readonly ProjectMediaItem[];
  openUploadSignal?: ProjectMediaOpenUploadSignal | null;
  controlledItems?: readonly ProjectMediaItem[];
  onItemsChange?: Dispatch<SetStateAction<ProjectMediaItem[]>>;
  onUploadOpenChange?: (open: boolean) => void;
  loadItems?: boolean;
  uploadSignalMode?: "enabled" | "disabled";
  requestCoordinator?: ProjectMediaRequestCoordinator;
};

export function ProjectMediaPanel(props: ProjectMediaPanelProps) {
  return <ProjectMediaPanelBody key={props.projectId} {...props} />;
}

function ProjectMediaPanelBody({
  projectId,
  canManage = false,
  phaseFilter,
  initialItems,
  openUploadSignal,
  controlledItems,
  onItemsChange,
  onUploadOpenChange,
  loadItems = true,
  uploadSignalMode,
  requestCoordinator,
}: ProjectMediaPanelProps) {
  const t = useTranslations("projectMedia");
  const dialog = useConfirmDialog();
  const phaseOptions = useProjectMediaPhaseOptions();
  const [localItems, setLocalItems] = useState<ProjectMediaItem[]>(() => initialItems ? [...initialItems] : []);
  const items = controlledItems ?? localItems;
  const [listState, setListState] = useState<ProjectMediaListState>(initialItems ? "ready" : "loading");
  const [listError, setListError] = useState("");
  const [selectedPhase, setSelectedPhase] = useState<string>("all");
  const [selectedKind, setSelectedKind] = useState<ProjectMediaKind>("photos");
  const [imagePreview, setImagePreview] = useState<ProjectMediaItem | null>(null);
  const [imagePreviewRevision, setImagePreviewRevision] = useState(0);
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [uploaderOpen, setUploaderOpen] = useState(false);
  const [uploaderPhase, setUploaderPhase] = useState<ProjectMediaPhase>(phaseFilter?.[0] ?? "survey");
  const [uploaderDocumentId, setUploaderDocumentId] = useState<string | null>(null);
  const [caption, setCaption] = useState("");
  const [queue, setQueue] = useState<ProjectMediaQueueItem[]>([]);
  const [uploading, setUploading] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const inputId = `project-media-input-${useId().replaceAll(":", "")}`;
  const titleId = `project-media-title-${useId().replaceAll(":", "")}`;
  const panelRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const uploaderFocusRootRef = useRef<HTMLDivElement>(null);
  const imageFocusRootRef = useRef<HTMLDivElement>(null);
  const [localRequestCoordinator] = useState<ProjectMediaRequestCoordinator>(() => ({
      mutationRevision: { current: 0 },
      requestSequence: { current: 0 },
      activeRequest: { current: null },
  }));
  const listRequests = requestCoordinator ?? localRequestCoordinator;

  const updateItems = useCallback((updater: (current: ProjectMediaItem[]) => ProjectMediaItem[]) => {
    if (controlledItems) {
      onItemsChange?.(updater);
      return;
    }
    setLocalItems(updater);
  }, [controlledItems, onItemsChange]);

  const mutateItems = useCallback((updater: (current: ProjectMediaItem[]) => ProjectMediaItem[]) => {
    listRequests.mutationRevision.current += 1;
    updateItems(updater);
  }, [listRequests, updateItems]);

  const refreshItems = useCallback(async (background = false) => {
    if (!background) setListState("loading");
    setListError("");
    const request = beginProjectMediaRequest(listRequests);
    try {
      const response = await fetch(
        `/api/mobile/services/projects/${encodeURIComponent(projectId)}/attachments`,
        { method: "GET", cache: "no-store", signal: request.controller.signal },
      );
      const body = await readProjectMediaResponse(response);
      if (!response.ok || !Array.isArray(body.data)) {
        throw new Error(body.error ?? "PROJECT_MEDIA_LIST_FAILED");
      }
      if (!isCurrentProjectMediaRequest(listRequests, request)) return null;
      updateItems((current) => mergeProjectMediaItems(current, body.data as ProjectMediaItem[]));
      setListState("ready");
      return body.data as ProjectMediaItem[];
    } catch {
      if (!isCurrentProjectMediaRequest(listRequests, request)) return null;
      setListState(items.length > 0 ? "ready" : "error");
      setListError(t("loadError"));
      return null;
    } finally {
      finishProjectMediaRequest(listRequests, request);
    }
  }, [items.length, listRequests, projectId, t, updateItems]);

  useEffect(() => {
    if (!loadItems) return;
    const request = beginProjectMediaRequest(listRequests);
    void fetch(
      `/api/mobile/services/projects/${encodeURIComponent(projectId)}/attachments`,
      { method: "GET", cache: "no-store", signal: request.controller.signal },
    ).then(async (response) => {
      const body = await readProjectMediaResponse(response);
      if (!response.ok || !Array.isArray(body.data)) {
        throw new Error(body.error ?? "PROJECT_MEDIA_LIST_FAILED");
      }
      if (!isCurrentProjectMediaRequest(listRequests, request)) return;
      if (controlledItems) {
        onItemsChange?.((current) => mergeProjectMediaItems(current, body.data as ProjectMediaItem[]));
      } else {
        setLocalItems((current) => mergeProjectMediaItems(current, body.data as ProjectMediaItem[]));
      }
      setListError("");
      setListState("ready");
    }).catch(() => {
      if (!isCurrentProjectMediaRequest(listRequests, request)) return;
      setListState(initialItems?.length ? "ready" : "error");
      setListError(t("loadError"));
    }).finally(() => {
      finishProjectMediaRequest(listRequests, request);
    });
    return () => {
      request.controller.abort();
      finishProjectMediaRequest(listRequests, request);
    };
    // Load once per project. Local mutations and coordinator updates keep the
    // signed descriptor collection coherent without triggering duplicate GETs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadItems, projectId]);

  useEffect(() => {
    if (!openUploadSignal) return;
    openUploader({
      phase: openUploadSignal.phase,
      documentId: openUploadSignal.documentId,
    });
    // sequence is the event identity; opening must not repeat on local state updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openUploadSignal?.sequence]);

  useEffect(() => {
    if (!uploaderOpen && !imagePreview) return;
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const restoreParentDialog = suspendParentProjectMediaDialog(panelRef.current);
    const focusRoot = imagePreview ? imageFocusRootRef.current : uploaderFocusRootRef.current;
    const childDialog = focusRoot?.closest('[role="dialog"][aria-modal="true"]');

    function focusableElements() {
      if (!childDialog) return [];
      return Array.from(childDialog.querySelectorAll<HTMLElement>(PROJECT_MEDIA_FOCUSABLE))
        .filter((element) => element.getClientRects().length > 0);
    }

    const initialTarget = focusableElements()[0] ?? focusRoot;
    initialTarget?.focus();

    function trapFocus(event: KeyboardEvent) {
      if (event.key === "Escape" && imagePreview) {
        event.preventDefault();
        event.stopImmediatePropagation();
        setImagePreview(null);
        return;
      }
      if (event.key !== "Tab") return;
      const target = projectMediaModalFocusTarget(
        focusableElements(),
        document.activeElement,
        event.shiftKey,
      );
      if (!target) return;
      event.preventDefault();
      target.focus();
    }

    document.addEventListener("keydown", trapFocus, true);
    return () => {
      document.removeEventListener("keydown", trapFocus, true);
      restoreParentDialog();
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, [uploaderOpen, imagePreview]);

  const filterOptions = useMemo(() => {
    const allowed = phaseFilter
      ? phaseOptions.filter((option) => phaseFilter.includes(option.value as ProjectMediaPhase))
      : phaseOptions;
    return [{ value: "all", label: t("allPhases") }, ...allowed];
  }, [phaseFilter, phaseOptions, t]);
  const uploaderPhaseOptions = useMemo(() => phaseOptions.filter((option) => (
    !phaseFilter
    || phaseFilter.includes(option.value as ProjectMediaPhase)
  )), [phaseFilter, phaseOptions]);
  const phaseItems = filterProjectMediaItems(
    items,
    phaseFilter,
    selectedPhase === "all" ? undefined : selectedPhase as ProjectMediaPhase,
  );
  const photos = filterProjectMediaKind(phaseItems, "photos");
  const documents = filterProjectMediaKind(phaseItems, "documents");
  const visibleItems = selectedKind === "photos" ? photos : documents;
  const failedCount = queue.filter((item) => item.status === "failed").length;
  const retryableFailedCount = retryableProjectMediaUploadCount(queue);
  const queuedCount = queue.filter((item) => item.status === "queued").length;
  const completeCount = queue.filter((item) => item.status === "complete").length;

  function openUploader(input: { phase?: ProjectMediaPhase; documentId?: string | null } = {}) {
    if (input.phase && phaseFilter && !phaseFilter.includes(input.phase)) return;
    setUploaderPhase(input.phase ?? phaseFilter?.[0] ?? "survey");
    setUploaderDocumentId(input.documentId ?? null);
    setCaption("");
    setQueue([]);
    setAnnouncement("");
    setUploaderOpen(true);
    onUploadOpenChange?.(true);
  }

  function addFiles(selected: FileList | readonly File[]) {
    const next = Array.from(selected).map<ProjectMediaQueueItem>((file) => {
      const valid = isAcceptedProjectMediaFile(file);
      return {
        localId: newProjectMediaLocalId(file),
        file,
        status: valid ? "queued" : "failed",
        progress: 0,
        error: valid ? undefined : t("unsupportedFile"),
        retryable: valid ? undefined : false,
        httpStatus: null,
        errorCategory: valid ? null : "validation",
      };
    });
    setQueue((current) => [...current, ...next]);
    setAnnouncement(t("selectedAnnouncement", { count: next.length }));
  }

  function patchQueue(localId: string, patch: UploadStatusPatch) {
    setQueue((current) => current.map((item) => (
      item.localId === localId ? { ...item, ...patch } : item
    )));
  }

  async function runUploads(targets: readonly ProjectMediaPendingFile[]) {
    if (targets.length === 0 || uploading) return;
    const snapshottedTargets = snapshotProjectMediaUploadTargets(targets, {
      phase: uploaderPhase,
      caption,
      documentId: uploaderDocumentId,
    });
    const uploadContextById = new Map(
      snapshottedTargets.map((target) => [target.localId, target.uploadContext]),
    );
    setQueue((current) => current.map((item) => (
      uploadContextById.has(item.localId)
        ? { ...item, uploadContext: uploadContextById.get(item.localId) }
        : item
    )));
    setUploading(true);
    const results = await uploadProjectMediaFiles({
      projectId,
      files: snapshottedTargets,
      phase: uploaderPhase,
      caption,
      documentId: uploaderDocumentId,
      onStatus: patchQueue,
    });
    const completed = results.flatMap((result) => result.item ? [result.item] : []);
    const failedById = new Map(results.flatMap((result) => (
      result.status === "failed" ? [[result.localId, result] as const] : []
    )));
    if (failedById.size > 0) {
      setQueue((current) => current.map((item) => {
        const failure = failedById.get(item.localId);
        if (!failure) return item;
        const errorCategory = failure.errorCategory ?? "invalid_response";
        return {
          ...item,
          retryable: failure.retryable,
          httpStatus: failure.httpStatus,
          errorCategory,
          error: t(projectMediaUploadErrorMessageKey(errorCategory)),
        };
      }));
    }
    if (completed.length > 0) {
      mutateItems((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of completed) byId.set(item.id, item);
        return Array.from(byId.values());
      });
      setListState("ready");
    }
    setUploading(false);
    const failures = results.filter((result) => result.status === "failed").length;
    setAnnouncement(failures > 0
      ? t("partialFailureAnnouncement", { complete: completed.length, failed: failures })
      : t("completeAnnouncement", { count: completed.length }));
  }

  async function retryFailed() {
    const targets = queue
      .filter((item) => item.status === "failed" && item.retryable)
      .map(({ localId, file, uploadContext }) => ({ localId, file, uploadContext }));
    setQueue((current) => current.map((item) => (
      targets.some((target) => target.localId === item.localId)
        ? {
            ...item,
            status: "queued",
            progress: 0,
            error: undefined,
            retryable: undefined,
            httpStatus: null,
            errorCategory: null,
          }
        : item
    )));
    await runUploads(targets);
  }

  async function openFresh(item: ProjectMediaItem) {
    setBusyIds((current) => new Set(current).add(item.id));
    const image = item.mimeType.toLowerCase().startsWith("image/");
    const preview = image ? null : window.open("about:blank", "_blank");
    if (preview) preview.opener = null;
    try {
      const refreshed = await refreshItems(true);
      const resolved = refreshed?.find((candidate) => candidate.id === item.id);
      if (!resolved?.signedUrl) throw new Error("PROJECT_MEDIA_SIGNED_URL_MISSING");
      if (image) {
        setImagePreview(resolved);
        setImagePreviewRevision((revision) => revision + 1);
      } else navigateProjectMediaPreview(preview, resolved.signedUrl);
    } catch {
      preview?.close();
      setListError(t("openError"));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  function downloadFresh(item: ProjectMediaItem) {
    const anchor = document.createElement("a");
    anchor.href = projectMediaDownloadUrl(projectId, item.id);
    anchor.download = item.fileName;
    anchor.rel = "noopener";
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
  }

  async function removeItem(item: ProjectMediaItem) {
    setBusyIds((current) => new Set(current).add(item.id));
    try {
      const deleted = await deleteProjectMediaItem({
        projectId,
        attachmentId: item.id,
        confirm: () => dialog.confirm({
          title: t("deleteTitle"),
          description: t("deleteConfirm", { fileName: item.fileName }),
          confirmLabel: t("deleteAction"),
          cancelLabel: t("cancel"),
          variant: "destructive",
        }),
      });
      if (!deleted) return;
      mutateItems((current) => current.filter((candidate) => candidate.id !== item.id));
      setAnnouncement(t("deletedAnnouncement", { fileName: item.fileName }));
    } catch {
      setListError(t("deleteError"));
    } finally {
      setBusyIds((current) => {
        const next = new Set(current);
        next.delete(item.id);
        return next;
      });
    }
  }

  return (
    <section
      ref={panelRef}
      className="overflow-visible rounded-xl border border-border bg-surface"
      aria-labelledby={titleId}
      data-project-media-phases={phaseFilter?.join(",") ?? "all"}
      data-project-media-upload-signal={uploadSignalMode}
    >
      <header className="flex flex-col gap-3 border-b border-border-soft px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary-50 text-primary-700">
            <ImageIcon aria-hidden="true" className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <h2 id={titleId} className="font-semibold">{t("title")}</h2>
            <p className="mt-1 text-xs text-slate-500">{t("subtitle", { count: phaseItems.length })}</p>
          </div>
        </div>
        <Button type="button" size="sm" onClick={() => openUploader()}>
          <Upload aria-hidden="true" className="h-4 w-4" />
          {t("add")}
        </Button>
      </header>
      <div className="p-4">
        <div className="mb-4" onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "photos" : event.key === "End" ? "documents" : selectedKind === "photos" ? "documents" : "photos";
          setSelectedKind(next);
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next === "photos" ? 0 : 1]?.focus();
        }}>
          <SegmentedTabs<ProjectMediaKind> items={[
            { id: "photos", label: t("photos"), count: photos.length },
            { id: "documents", label: t("documents"), count: documents.length },
          ]} value={selectedKind} onChange={setSelectedKind} />
        </div>
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="w-full sm:w-56">
            <ProjectMediaPhasePicker
              label={t("filterLabel")}
              value={selectedPhase}
              options={filterOptions}
              onChange={setSelectedPhase}
            />
          </div>
          <Button type="button" variant="ghost" size="sm" onClick={() => void refreshItems()}>
            <RefreshCw aria-hidden="true" className="h-4 w-4" />
            {t("refresh")}
          </Button>
        </div>
        {listError && listState === "ready" && (
          <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-xs font-medium text-er">{listError}</p>
        )}
        <div role="tabpanel" aria-label={t(selectedKind)} tabIndex={0}>
          <ProjectMediaListView
            state={listState}
            items={visibleItems}
            error={listError}
            onRetry={() => void refreshItems()}
            onOpen={(item) => void openFresh(item)}
            onDownload={downloadFresh}
            onDelete={(item) => void removeItem(item)}
            busyIds={busyIds}
            kind={selectedKind}
          />
        </div>
      </div>
      <p className="sr-only" aria-live="polite" aria-atomic="true">{announcement}</p>
      {imagePreview?.signedUrl && typeof document !== "undefined" && createPortal(
        <RowPreviewModal open title={t("previewTitle")} subtitle={<span title={imagePreview.fileName}>{imagePreview.fileName}</span>}
          closeLabel={t("close")} onClose={() => setImagePreview(null)} size="full" bodyClassName="overflow-hidden p-0 sm:p-0"
          footer={<div className="flex items-center justify-between gap-3">
            <p className="min-w-0 truncate text-xs text-slate-500" title={imagePreview.caption ?? undefined}>{imagePreview.caption || t(`phases.${imagePreview.phase}`)} · {formatProjectMediaBytes(imagePreview.sizeBytes)}</p>
            <Button type="button" variant="ghost" size="sm" aria-label={t("downloadFile", { fileName: imagePreview.fileName })} onClick={() => downloadFresh(imagePreview)}><Download className="h-4 w-4" /></Button>
          </div>}>
          <div ref={imageFocusRootRef} className="flex h-full min-h-0 flex-col lg:flex-row">
            <div className="min-h-0 min-w-0 flex-1">
              <ProjectImageViewport key={imagePreviewRevision} url={imagePreview.signedUrl} fileName={imagePreview.fileName} onRetry={() => void openFresh(imagePreview)} />
            </div>
            <aside className="max-h-[45dvh] shrink-0 overflow-y-auto overscroll-contain bg-surface px-4 lg:max-h-full lg:w-72 lg:border-l lg:border-border">
              <ProjectFileInfo item={imagePreview} canManage={canManage} />
            </aside>
          </div>
        </RowPreviewModal>, document.body)}

      {uploaderOpen && typeof document !== "undefined" && createPortal(<RowPreviewModal
        open={uploaderOpen}
        onClose={() => {
          if (uploading) return;
          setUploaderOpen(false);
          onUploadOpenChange?.(false);
        }}
        title={uploaderPhase === "after_installation" ? t("postInstallTitle") : t("uploadTitle")}
        subtitle={uploaderDocumentId ? t("linkedUpload") : t("uploadSubtitle")}
        closeLabel={t("close")}
        size="lg"
        footer={(
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-slate-500" aria-live="polite">
              {t("queueSummary", { queued: queuedCount, complete: completeCount, failed: failedCount })}
            </p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={uploading}
                onClick={() => {
                  setUploaderOpen(false);
                  onUploadOpenChange?.(false);
                }}
              >
                {t("close")}
              </Button>
              {retryableFailedCount > 0 && (
                <Button type="button" variant="outline" size="sm" disabled={uploading} onClick={() => void retryFailed()}>
                  {t("retryFailed", { count: retryableFailedCount })}
                </Button>
              )}
              {queuedCount > 0 && (
                <Button
                  type="button"
                  size="sm"
                  loading={uploading}
                  onClick={() => void runUploads(queue.filter((item) => item.status === "queued").map(({ localId, file }) => ({ localId, file })))}
                >
                  <Upload aria-hidden="true" className="h-4 w-4" />
                  {t("uploadFiles", { count: queuedCount })}
                </Button>
              )}
            </div>
          </div>
        )}
      >
        <div ref={uploaderFocusRootRef} tabIndex={-1} className="space-y-5 focus:outline-none">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label={t("phaseLabel")} required>
              <ProjectMediaPhasePicker
                label={t("phaseLabel")}
                value={uploaderPhase}
                options={uploaderPhaseOptions}
                onChange={(value) => setUploaderPhase(value as ProjectMediaPhase)}
                disabled={uploading || Boolean(uploaderDocumentId)}
              />
            </Field>
            <Field label={t("captionLabel")}>
              <Input aria-label={t("captionLabel")} value={caption} disabled={uploading} maxLength={500} onChange={(event) => setCaption(event.target.value)} placeholder={t("captionPlaceholder")} />
            </Field>
          </div>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            multiple
            accept={PROJECT_MEDIA_ACCEPT}
            className="hidden"
            disabled={uploading}
            onChange={(event) => {
              if (event.target.files) addFiles(event.target.files);
              event.target.value = "";
            }}
          />
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              if (!uploading) addFiles(event.dataTransfer.files);
            }}
            className={cn(
              "flex min-h-36 w-full cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-primary-300 bg-primary-50/40 px-4 py-6 text-center transition-colors hover:border-primary-500 hover:bg-primary-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2",
              uploading && "cursor-not-allowed opacity-60",
            )}
            disabled={uploading}
          >
            <span className="flex items-center gap-2 text-primary-700">
              <Camera aria-hidden="true" className="h-6 w-6" />
              <Upload aria-hidden="true" className="h-6 w-6" />
            </span>
            <span className="mt-3 text-sm font-semibold text-slate-900">{t("dropTitle")}</span>
            <span className="mt-1 text-xs text-slate-500">{t("dropHint")}</span>
          </button>
          {queue.length > 0 && (
            <div className="space-y-2" aria-label={t("queueLabel")}>
              {queue.map((item) => (
                <UploadQueueRow
                  key={item.localId}
                  item={item}
                  removeLabel={t("removeQueued", { fileName: item.file.name })}
                  statusLabel={t(`statuses.${item.status}`)}
                  onRemove={() => setQueue((current) => current.filter((candidate) => candidate.localId !== item.localId))}
                />
              ))}
            </div>
          )}
        </div>
      </RowPreviewModal>, document.body)}
    </section>
  );
}

type ProjectMediaCoordinatorValue = {
  signal: ProjectMediaOpenUploadSignal | null;
  open: (phase: ProjectMediaPhase, documentId?: string | null) => void;
  items: ProjectMediaItem[];
  setItems: Dispatch<SetStateAction<ProjectMediaItem[]>>;
  requestCoordinator: ProjectMediaRequestCoordinator;
};

const ProjectMediaCoordinatorContext = createContext<ProjectMediaCoordinatorValue | null>(null);

export function ProjectMediaUploadCoordinator({
  initialItems,
  children,
}: {
  initialItems: readonly ProjectMediaItem[];
  children: ReactNode;
}) {
  const [signal, setSignal] = useState<ProjectMediaOpenUploadSignal | null>(null);
  const [items, setItems] = useState<ProjectMediaItem[]>([...initialItems]);
  const sequence = useRef(0);
  const [requestCoordinator] = useState<ProjectMediaRequestCoordinator>(() => ({
    mutationRevision: { current: 0 },
    requestSequence: { current: 0 },
    activeRequest: { current: null },
  }));
  const open = useCallback((phase: ProjectMediaPhase, documentId?: string | null) => {
    sequence.current += 1;
    setSignal({ sequence: sequence.current, phase, documentId });
  }, []);
  return (
    <ProjectMediaCoordinatorContext.Provider value={{
      signal,
      open,
      items,
      setItems,
      requestCoordinator,
    }}>
      {children}
    </ProjectMediaCoordinatorContext.Provider>
  );
}

export function ProjectMediaUploadButton({
  phase,
  documentId,
  className,
}: {
  phase: ProjectMediaPhase;
  documentId?: string | null;
  className?: string;
}) {
  const t = useTranslations("projectMedia");
  const context = useProjectMediaCoordinator();
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className={cn(
        className,
        "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11 lg:min-h-0 lg:min-w-0",
      )}
      onClick={() => context.open(phase, documentId)}
    >
      <Upload aria-hidden="true" className="h-4 w-4" />
      {t("addRecordFile")}
    </Button>
  );
}

export function ProjectMediaRecordLinks({ documentId }: { documentId: string }) {
  const t = useTranslations("projectMedia");
  const context = useProjectMediaCoordinator();
  const linked = context.items.filter((item) => item.documentIds?.includes(documentId));
  if (linked.length === 0) return null;
  return (
    <div className="mt-2 rounded-lg bg-primary-50 px-2.5 py-2 text-[11px] text-primary-800">
      <p className="font-semibold">{t("recordFiles", { count: linked.length })}</p>
      <p className="mt-1 truncate">{linked.map((item) => item.fileName).join(" · ")}</p>
    </div>
  );
}

export function CoordinatedProjectMediaPanel({
  projectId,
  canManage = false,
  phaseFilter,
  loadItems = true,
  receiveUploadSignal = true,
}: {
  projectId: string;
  canManage?: boolean;
  phaseFilter?: readonly ProjectMediaPhase[];
  loadItems?: boolean;
  receiveUploadSignal?: boolean;
}) {
  const context = useProjectMediaCoordinator();
  return (
    <ProjectMediaPanel
      projectId={projectId}
      canManage={canManage}
      phaseFilter={phaseFilter}
      initialItems={context.items}
      controlledItems={context.items}
      openUploadSignal={receiveUploadSignal ? context.signal : null}
      onItemsChange={context.setItems}
      loadItems={loadItems}
      uploadSignalMode={receiveUploadSignal ? "enabled" : "disabled"}
      requestCoordinator={context.requestCoordinator}
    />
  );
}

function useProjectMediaCoordinator() {
  const context = useContext(ProjectMediaCoordinatorContext);
  if (!context) throw new Error("Project media controls require ProjectMediaUploadCoordinator");
  return context;
}

function UploadQueueRow({
  item,
  statusLabel,
  removeLabel,
  onRemove,
}: {
  item: ProjectMediaQueueItem;
  statusLabel: string;
  removeLabel: string;
  onRemove: () => void;
}) {
  const Icon = item.file.type.startsWith("image/") ? ImageIcon : FileText;
  return (
    <div className="rounded-xl border border-border-soft px-3 py-3">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-surface-2 text-primary-700">
          <Icon aria-hidden="true" className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{item.file.name}</p>
          <p role="status" aria-live="polite" className={cn(
            "mt-1 text-xs",
            item.status === "failed" ? "text-er" : item.status === "complete" ? "text-ok" : "text-slate-500",
          )}>
            {statusLabel}{item.error ? ` · ${item.error}` : ""}
          </p>
        </div>
        {(item.status === "queued" || item.status === "failed") && (
          <button
            type="button"
            onClick={onRemove}
            aria-label={removeLabel}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 hover:bg-surface-2 hover:text-slate-700 lg:h-9 lg:w-9"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        )}
      </div>
      <div
        role="progressbar"
        aria-label={`${item.file.name}: ${statusLabel}`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={item.progress}
        className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2"
      >
        <span
          className={cn(
            "block h-full rounded-full transition-[width]",
            item.status === "failed" ? "bg-er" : item.status === "complete" ? "bg-ok" : "bg-primary-600",
          )}
          style={{ width: `${item.progress}%` }}
        />
      </div>
    </div>
  );
}

function useProjectMediaPhaseOptions() {
  const t = useTranslations("projectMedia");
  return useMemo(
    () => PROJECT_MEDIA_PHASES.map(([value]) => ({ value, label: t(`phases.${value}`) })),
    [t],
  );
}

async function readProjectMediaResponse(response: Response): Promise<{
  data?: ProjectMediaItem | ProjectMediaItem[];
  error?: string;
}> {
  try {
    return await response.json() as {
      data?: ProjectMediaItem | ProjectMediaItem[];
      error?: string;
    };
  } catch {
    return {};
  }
}

function isAcceptedProjectMediaFile(file: File) {
  if (file.size <= 0 || file.size > PROJECT_MEDIA_MAX_BYTES) return false;
  if (PROJECT_MEDIA_ACCEPT.split(",").includes(file.type.toLowerCase())) return true;
  return /\.(avif|gif|heic|heif|jpe?g|png|webp|pdf|docx|xlsx|pptx)$/i.test(file.name);
}

function newProjectMediaLocalId(file: File) {
  void file;
  return crypto.randomUUID();
}

function restoreAttribute(element: Element, name: string, value: string | null) {
  if (value === null) element.removeAttribute(name);
  else element.setAttribute(name, value);
}

function formatProjectMediaBytes(bytes: number) {
  if (bytes < 1_024) return `${bytes} B`;
  if (bytes < 1_048_576) return `${Math.round(bytes / 1_024)} KB`;
  return `${(bytes / 1_048_576).toFixed(bytes < 10_485_760 ? 1 : 0)} MB`;
}
