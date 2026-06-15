"use client";

import { Menu } from "lucide-react";

/** Mở/đóng drawer điều hướng trên mobile qua data-mobilenav trên <html>. */
function setMobileNav(open: boolean) {
  document.documentElement.dataset.mobilenav = open ? "open" : "";
}

export function MobileNavButton() {
  return (
    <button onClick={() => setMobileNav(true)} className="p-2 -ml-1 rounded-lg text-slate-600 dark:text-slate-300 hover:bg-surface-2" aria-label="menu">
      <Menu className="w-5 h-5" />
    </button>
  );
}

/** Nền mờ phía sau drawer — bấm để đóng (chỉ hiện khi mở trên mobile). */
export function MobileNavBackdrop() {
  return <div onClick={() => setMobileNav(false)} className="mobile-nav-backdrop fixed inset-0 z-[55] bg-black/40 lg:hidden" />;
}
