"use client";

import { PanelLeftClose, PanelLeft } from "lucide-react";
import { useTranslations } from "next-intl";

const KEY = "sidebar-collapsed";

/** DOM mutation tách module-scope cho react-compiler. */
function applyCollapsed(v: boolean) {
  document.documentElement.dataset.sidebar = v ? "collapsed" : "";
}

function toggleSidebar() {
  const cur = document.documentElement.dataset.sidebar === "collapsed";
  const next = !cur;
  applyCollapsed(next);
  try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* bỏ qua */ }
}

/**
 * Nút thu gọn / mở sidebar. Dùng data-attribute trên <html> + CSS nên 2 nút
 * (trong sidebar và nút nổi khi đã thu gọn) luôn đồng bộ, không cần context.
 * variant "inline" nằm trong sidebar; "floating" nổi góc trái khi đã thu gọn.
 */
export function SidebarToggle({ variant = "inline" }: { variant?: "inline" | "floating" }) {
  const t = useTranslations();
  if (variant === "floating") {
    return (
      <button
        onClick={toggleSidebar}
        title={t("nav.expandSidebar")}
        className="sidebar-reopen fixed top-3 left-3 z-40 w-9 h-9 rounded-lg bg-surface border border-border shadow-e1 grid place-items-center text-slate-500 hover:text-primary-600"
      >
        <PanelLeft className="w-4 h-4" />
      </button>
    );
  }
  return (
    <button
      onClick={toggleSidebar}
      title={t("nav.collapseSidebar")}
      className="shrink-0 p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-surface-2"
    >
      <PanelLeftClose className="w-4 h-4" />
    </button>
  );
}
