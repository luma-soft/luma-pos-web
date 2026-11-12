"use client";

import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Routes } from "@/lib/routes";
import { Button } from "@/components/ui/button";
import { clearProductCatalogSnapshotsForUser } from "@/lib/offline/product-catalog-store";
import { clearCachedStockHistoryForUser } from "@/lib/offline/product-stock-history-store";

export function LogoutButton({ userId }: { userId: string }) {
  const router = useRouter();

  async function logout() {
    await Promise.all([
      clearProductCatalogSnapshotsForUser(userId),
      clearCachedStockHistoryForUser(userId),
    ]);
    await fetch("/api/auth/logout", { method: "POST" });
    router.push(Routes.Login);
    router.refresh();
  }

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
