import type { ReactNode } from "react";

/** Thanh header trang theo design (topbar trắng, sticky, title trái + actions phải). */
export function PageHeader({
  title, badge, children,
}: { title: ReactNode; badge?: ReactNode; children?: ReactNode }) {
  return (
    <header className="sticky top-0 z-20 min-h-[58px] bg-surface border-b border-border px-6 py-2.5 flex items-center gap-3 flex-wrap">
      <h1 className="text-[17px] font-bold">{title}</h1>
      {badge}
      <div className="flex-1" />
      {children}
    </header>
  );
}
