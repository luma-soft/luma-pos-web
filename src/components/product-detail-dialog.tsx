import { type ReactNode } from "react";
import { X } from "lucide-react";
import { ProductModalFrame } from "@/components/product-modal-frame";
import { ProductModalCloseButton } from "@/components/product-modal-close-button";

export function ProductDetailDialog({
  title,
  subtitle,
  children,
  closeHref,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
  closeHref?: string;
}) {
  return (
    <ProductModalFrame labelledBy="product-detail-title" closeHref={closeHref} closeOnBackdrop>
      <div className="flex shrink-0 items-center justify-between gap-4 border-b border-border-soft px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h2 id="product-detail-title" className="truncate text-lg font-bold text-slate-900 dark:text-slate-100">
            {title}
          </h2>
          <p className="truncate text-sm text-slate-400">{subtitle}</p>
        </div>
        <ProductModalCloseButton closeHref={closeHref} aria-label="Đóng chi tiết sản phẩm">
          <X className="h-5 w-5" />
        </ProductModalCloseButton>
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </ProductModalFrame>
  );
}
