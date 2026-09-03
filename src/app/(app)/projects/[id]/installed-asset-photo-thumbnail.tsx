"use client";

import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { InstalledAssetPhotoPreview, loadInstalledAssetPhoto, type AssetPhoto } from "./installed-asset-photo-preview";

export function InstalledAssetPhotoThumbnail({
  assetId,
  assetName,
}: {
  assetId: string;
  assetName: string;
}) {
  const t = useTranslations("projectMedia");
  const [photo, setPhoto] = useState<AssetPhoto | null | undefined>(undefined);
  const [previewTrigger, setPreviewTrigger] = useState<HTMLElement | null>(null);
  const closePreview = useCallback(() => setPreviewTrigger(null), []);

  useEffect(() => {
    const controller = new AbortController();
    void loadInstalledAssetPhoto(assetId, null, controller.signal)
      .then((next) => {
        if (!controller.signal.aborted) setPhoto(next);
      })
      .catch(() => {
        if (!controller.signal.aborted) setPhoto(null);
      });
    return () => controller.abort();
  }, [assetId]);

  if (photo) return <>
    <button type="button" onClick={(event) => setPreviewTrigger(event.currentTarget)}
      aria-label={t("openFile", { fileName: photo.fileName })} aria-haspopup="dialog"
      className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border-soft bg-surface-2 text-slate-400 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-600">
      <Image src={photo.signedUrl} alt={assetName} width={48} height={48} unoptimized className="h-full w-full object-cover" />
    </button>
    {previewTrigger && <InstalledAssetPhotoPreview assetId={assetId} assetName={assetName} photo={photo} trigger={previewTrigger} onClose={closePreview} />}
  </>;
  return (
    <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border-soft bg-surface-2 text-slate-400">
      {photo === undefined ? (
        <span className="h-full w-full animate-pulse bg-slate-100" aria-label={t("loadingLabel")} />
      ) : (
        <ImageIcon aria-hidden="true" className="h-5 w-5" />
      )}
    </span>
  );
}
