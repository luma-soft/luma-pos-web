"use client";

import Image from "next/image";
import { ImageIcon } from "lucide-react";
import { useEffect, useState } from "react";

type AssetPhoto = {
  id: string;
  signedUrl: string;
  isPrimary: boolean;
  sortOrder: number;
};

export function InstalledAssetPhotoThumbnail({
  assetId,
  assetName,
}: {
  assetId: string;
  assetName: string;
}) {
  const [url, setUrl] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/mobile/services/assets/${assetId}/attachments`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) return null;
        const body = await response.json() as { ok?: boolean; data?: AssetPhoto[] };
        const photos = body.ok && Array.isArray(body.data) ? body.data : [];
        const primary = photos.find((photo) => photo.isPrimary) ?? photos[0];
        return primary?.signedUrl ?? null;
      })
      .then((nextUrl) => {
        if (!controller.signal.aborted) setUrl(nextUrl);
      })
      .catch(() => {
        if (!controller.signal.aborted) setUrl(null);
      });
    return () => controller.abort();
  }, [assetId]);

  return (
    <span className="relative grid h-12 w-12 shrink-0 place-items-center overflow-hidden rounded-xl border border-border-soft bg-surface-2 text-slate-400">
      {url ? (
        <Image
          src={url}
          alt={`Ảnh chính của ${assetName}`}
          width={48}
          height={48}
          unoptimized
          className="h-full w-full object-cover"
        />
      ) : url === undefined ? (
        <span className="h-full w-full animate-pulse bg-slate-100" aria-label="Đang tải ảnh thiết bị" />
      ) : (
        <ImageIcon aria-hidden="true" className="h-5 w-5" />
      )}
    </span>
  );
}
