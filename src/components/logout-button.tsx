"use client";

import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { LogOut } from "lucide-react";
import { Routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { MobileListRowContent, mobileListRowClass } from "@/components/mobile-ui";
import { clearProductCatalogSnapshotsForUser } from "@/lib/offline/product-catalog-store";
import { clearCachedStockHistoryForUser } from "@/lib/offline/product-stock-history-store";

function useLogout(userId: string) {
  const router = useRouter();
  return async function logout() {
    await Promise.all([
      clearProductCatalogSnapshotsForUser(userId),
      clearCachedStockHistoryForUser(userId),
    ]);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push(Routes.Login);
    router.refresh();
  };
}

export function LogoutButton({ userId }: { userId: string }) {
  const logout = useLogout(userId);

  return (
    <Button
      type="button"
      variant="ghost"
      block
      onClick={logout}
      tx="auth.logout"
      className="justify-start px-3"
    >
      <LogOut className="w-4 h-4" />
    </Button>
  );
}

/** Destructive "Sign out" list row with the native confirmation alert (MoreView.swift). */
export function MobileLogoutRow({ userId }: { userId: string }) {
  const t = useTranslations();
  const { confirm } = useConfirmDialog();
  const logout = useLogout(userId);

  async function confirmLogout() {
    const confirmed = await confirm({
      title: t("mobile.more.logoutConfirmTitle"),
      description: t("mobile.more.logoutConfirmMessage"),
      confirmLabel: t("auth.logout"),
      variant: "destructive",
    });
    if (confirmed) await logout();
  }

  return (
    <button type="button" onClick={confirmLogout} className={mobileListRowClass}>
      <MobileListRowContent icon={LogOut} title={t("auth.logout")} destructive showsChevron={false} />
    </button>
  );
}
