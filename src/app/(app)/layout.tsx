import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { getRole, requireUser } from "@/lib/actions/common";
import { LogoutButton } from "@/components/logout-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { ModeSwitcher } from "@/components/mode-switcher";
import { AppNav } from "@/components/app-nav";
import { MobileNavBackdrop } from "@/components/mobile-nav";
import { MobileTabBar } from "@/components/mobile-tabbar";
import { AiAssistantLauncher } from "@/components/ai-assistant-launcher";
import { Text } from "@/components/ui/text";
import { Routes } from "@/lib/routes";
import { getTheme, getMode } from "@/lib/theme/cookie";
import { getStoreSettings } from "@/lib/data/settings";
import { getAttentionNotificationCount } from "@/lib/audit";
import { ProductCatalogProvider } from "@/components/product-catalog-provider";

export const dynamic = "force-dynamic";

export default async function AppLayout({
  children,
  productModal,
  orderModal,
}: {
  children: React.ReactNode;
  productModal: React.ReactNode;
  orderModal: React.ReactNode;
}) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect(Routes.Login);
  }

  const [store, notificationCount] = await Promise.all([
    getStoreSettings(),
    getAttentionNotificationCount(user.id),
  ]);
  if (!store.onboarded) redirect("/onboarding");

  const t = await getTranslations();
  const theme = await getTheme();
  const mode = await getMode();
  const role = await getRole(user.id);
  const catalogScopeId = `${user.id}:${role}`;

  return (
    <ProductCatalogProvider userId={user.id} scopeId={catalogScopeId}>
    <div className="h-dvh min-h-0 flex bg-canvas">
      <MobileNavBackdrop />

      <aside className="app-sidebar w-60 shrink-0 bg-surface border-r border-border flex flex-col sticky top-0 h-dvh overflow-hidden">
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl shrink-0 grid place-items-center text-white font-extrabold bg-gradient-to-br from-primary-600 to-primary-400">
            L
          </div>
          <div className="min-w-0 flex-1">
            <Text as="h1" weight="bold" className="leading-tight" text={t("common.appName")} />
            <Text as="p" variant="muted" truncate className="text-[11px]" text={user.email} />
          </div>
        </div>
        <AppNav
          industry={store.industry}
          notificationCount={notificationCount}
          aiConfigured={store.prefs.ai.openaiApiKeySet}
        />
        <div className="p-3 border-t border-border space-y-2">
          <ModeSwitcher current={mode} />
          <ThemeSwitcher current={theme} />
          <LanguageSwitcher />
          <LogoutButton userId={user.id} />
        </div>
      </aside>

      <main className="flex-1 min-h-0 min-w-0 overflow-auto overflow-x-hidden">
        <div className="pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">{children}</div>
        <MobileTabBar />
        {store.prefs.ai.openaiApiKeySet && store.prefs.ai.showFloatingLauncher && <AiAssistantLauncher />}
      </main>
      {orderModal}
      {productModal}
    </div>
    </ProductCatalogProvider>
  );
}
