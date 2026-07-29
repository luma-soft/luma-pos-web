"use client";

import { useState } from "react";
import { createPortal } from "react-dom";
import type { PosProduct } from "@/lib/data/pos";
import { categoryEmoji } from "@/lib/category-emoji";

/** Search-result thumbnail with an isolated, full-size image preview. */
export function PosProductThumbnail({ product }: { product: PosProduct }) {
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
          <img
            src={imageUrl}
            alt={product.name}
            className="h-full w-full object-cover"
            onError={() => setImageFailed(true)}
          />
        </button>
      ) : (
        <div className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-md bg-surface-2 text-lg">
          {categoryEmoji(product.categoryName)}
        </div>
      )}
      {previewOpen && imageUrl && typeof document !== "undefined" && createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Ảnh ${product.name}`}
          className="fixed inset-0 z-[120] grid place-items-center bg-slate-950/70 p-6"
          onClick={() => setPreviewOpen(false)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={imageUrl}
            alt={product.name}
            className="max-h-full max-w-full rounded-xl object-contain shadow-e2"
            onClick={(event) => event.stopPropagation()}
          />
        </div>,
        document.body,
      )}
    </>
  );
}
