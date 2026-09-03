"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { RowPreviewModal } from "@/components/data-table";
import { FileInfoPanel } from "@/components/media/file-info-panel";
import { Button } from "@/components/ui/button";
import { ProjectImageViewport } from "./project-image-viewport";
import { ProjectFileInfo } from "./project-file-info";
import { projectMediaModalFocusTarget, suspendParentProjectMediaDialog } from "./project-media-panel";

export type AssetPhoto = {
  id: string;
  mediaObjectId?: string | null;
  signedUrl: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  createdAt: string;
  isPrimary: boolean;
  sortOrder: number;
};

export async function loadInstalledAssetPhoto(assetId: string, photoId: string | null, signal: AbortSignal, fetcher: typeof fetch = fetch) {
  const response = await fetcher(`/api/mobile/services/assets/${encodeURIComponent(assetId)}/attachments`, {
    cache: "no-store", credentials: "same-origin", signal,
  });
  const body = await response.json() as { ok?: boolean; data?: AssetPhoto[] };
  if (!response.ok || !body.ok || !Array.isArray(body.data)) throw new Error("ASSET_PHOTO_LOAD_FAILED");
  const photo = photoId ? body.data.find((item) => item.id === photoId)
    : body.data.find((item) => item.isPrimary) ?? body.data[0];
  return photo?.signedUrl ? photo : null;
}

export function AssetPhotoFileInfo({ photo }: { photo: AssetPhoto }) {
  const t = useTranslations("fileInfo");
  const mediaId = photo.mediaObjectId;
  if (mediaId) return <ProjectFileInfo canManage={false} item={{ mediaId,
    fileName: photo.fileName, mimeType: photo.mimeType, sizeBytes: photo.sizeBytes, createdAt: photo.createdAt }} />;
  return <>
    <FileInfoPanel key={photo.id}
      fileName={photo.fileName} mimeType={photo.mimeType} sizeBytes={photo.sizeBytes} uploadedAt={photo.createdAt}
      canManage={false}
    />
    <p className="pb-3 text-xs leading-5 text-slate-500">{t("legacyFileHint")}</p>
  </>;
}

export function InstalledAssetPhotoPreview({ assetId, assetName, photo, trigger, onClose }: {
  assetId: string; assetName: string; photo: AssetPhoto; trigger: HTMLElement | null; onClose: () => void;
}) {
  const t = useTranslations("projectMedia");
  const [resolved, setResolved] = useState<AssetPhoto | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const controller = new AbortController();
    void loadInstalledAssetPhoto(assetId, photo.id, controller.signal).then((next) => {
      if (controller.signal.aborted) return;
      if (!next) setFailed(true);
      else setResolved(next);
    }).catch(() => { if (!controller.signal.aborted) setFailed(true); });
    return () => controller.abort();
  }, [assetId, photo.id, attempt]);

  useEffect(() => {
    const restoreParent = suspendParentProjectMediaDialog(trigger);
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const dialog = root.current?.closest('[role="dialog"][aria-modal="true"]');
    const focusables = () => Array.from(dialog?.querySelectorAll<HTMLElement>('a[href],button:not([disabled]),summary,[tabindex]:not([tabindex="-1"])') ?? [])
      .filter((element) => element.getClientRects().length > 0);
    focusables()[0]?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
      } else if (event.key === "Tab") {
        const target = projectMediaModalFocusTarget(focusables(), document.activeElement, event.shiftKey);
        if (target) { event.preventDefault(); target.focus(); }
      }
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown, true);
      restoreParent();
      document.body.style.overflow = oldOverflow;
      if (trigger?.isConnected) trigger.focus();
    };
  }, [onClose, trigger]);

  function retry() { setResolved(null); setFailed(false); setAttempt((value) => value + 1); }
  if (typeof document === "undefined") return null;
  return createPortal(<RowPreviewModal open title={t("previewTitle")} subtitle={<span title={photo.fileName}>{photo.fileName}</span>}
    closeLabel={t("close")} onClose={onClose} size="full" bodyClassName="overflow-hidden p-0 sm:p-0"
    footer={<div className="flex items-center justify-between gap-3"><p className="min-w-0 truncate text-xs text-slate-500">{assetName}</p><Button type="button" variant="outline" size="sm" onClick={onClose}>{t("close")}</Button></div>}>
    <div ref={root} className="flex h-full min-h-0 flex-col lg:flex-row">
      <div className="min-h-0 min-w-0 flex-1">
        {failed ? <div className="grid h-full place-content-center gap-3 p-4 text-center"><p role="alert" className="text-sm">{t("openError")}</p><Button type="button" variant="outline" onClick={retry}>{t("retry")}</Button></div>
          : resolved ? <ProjectImageViewport key={attempt} url={resolved.signedUrl} fileName={resolved.fileName} onRetry={retry} />
            : <div role="status" aria-label={t("loadingLabel")} className="grid h-full place-items-center"><LoaderCircle aria-hidden="true" className="h-6 w-6 animate-spin text-primary-600" /></div>}
      </div>
      {resolved && <aside className="max-h-[45dvh] shrink-0 overflow-y-auto overscroll-contain bg-surface px-4 lg:max-h-full lg:w-72 lg:border-l lg:border-border"><AssetPhotoFileInfo photo={resolved} /></aside>}
    </div>
  </RowPreviewModal>, document.body);
}
