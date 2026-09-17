"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import { categoryEmoji } from "@/lib/category-emoji";

type ProductThumbnailLike = {
  name: string;
  categoryName?: string | null;
  imageUrls?: string[] | null;
};

export function ProductSearchThumbnail({ product }: { product: ProductThumbnailLike }) {
  const imageUrl = Array.isArray(product.imageUrls) && typeof product.imageUrls[0] === "string"
    ? product.imageUrls[0].trim()
    : "";
  const [imageFailed, setImageFailed] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  return (
    <>
      {imageUrl && !imageFailed ? (
        <button
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setPreviewOpen(true);
          }}
          className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2 text-lg transition-opacity hover:opacity-80"
          aria-label={`Xem ảnh ${product.name}`}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={product.name} className="h-full w-full object-cover" onError={() => setImageFailed(true)} />
        </button>
      ) : (
        <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2 text-lg">
          {categoryEmoji(product.categoryName ?? null)}
        </div>
      )}
      {previewOpen && imageUrl && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Ảnh ${product.name}`}
          className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/70 p-6"
          onClick={(event) => {
            event.stopPropagation();
            setPreviewOpen(false);
          }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={imageUrl} alt={product.name} className="max-h-full max-w-full rounded-xl object-contain shadow-e2" onClick={(event) => event.stopPropagation()} />
        </div>,
        document.body,
      )}
    </>
  );
}
