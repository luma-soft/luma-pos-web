import {
  Bell,
  BarChart3,
  Users,
  Truck,
  BriefcaseBusiness,
  Sparkles,
  Wallet,
  RotateCcw,
  Clock3,
  Wrench,
  Settings,
  Store,
  UserRoundCog,
  PackageSearch,
  ShoppingCart,
  ClipboardCheck,
  Camera,
  Cpu,
  Lightbulb,
  Printer,
  Images,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getRole, requireUser } from "@/lib/actions/common";
import { getStoreSettings } from "@/lib/data/settings";
import { Routes } from "@/lib/routes";
import { MobileSectionLabel, MobileSettingsRow, MobileTopBar } from "@/components/mobile-ui";
import { MobileMoreQuickSearch, type MobileMoreSearchEntry } from "@/components/mobile-more-quick-search";
import { ModeSwitcher } from "@/components/mode-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoutButton } from "@/components/logout-button";
import { getMode, getTheme } from "@/lib/theme/cookie";
import { requireStoreContext } from "@/lib/auth/store-context";
import { SHIFT_MANAGEMENT_UI_ENABLED } from "@/lib/features";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const user = await requireUser();
  const context = await requireStoreContext();
  const [role, store, t, mode, theme] = await Promise.all([
    getRole(user.id),
    getStoreSettings(context.storeId),
    getTranslations(),
    getMode(),
    getTheme(),
  ]);
  const manager = role === "owner" || role === "manager";
  const stock = manager || role === "warehouse";
  const sales = manager || role === "cashier";
  const searchEntries: MobileMoreSearchEntry[] = [
    { href: Routes.Notifications, label: t("nav.notifications"), subtitle: t("mobile.more.notificationsHint") },
    ...(manager ? [{ href: Routes.Reports, label: t("nav.reports"), subtitle: t("mobile.more.reportsHint") }] : []),
    ...(sales ? [
      { href: Routes.Customers, label: t("nav.customers"), subtitle: t("mobile.more.customersHint") },
      { href: Routes.Projects, label: t("nav.projects"), subtitle: t("mobile.more.projectsHint") },
    ] : []),
    ...(stock ? [
      { href: Routes.Suppliers, label: t("nav.suppliers"), subtitle: t("mobile.more.suppliersHint") },
      { href: `${Routes.Inventory}?tab=products`, label: t("nav.products"), subtitle: t("mobile.more.productsHint") },
      { href: `${Routes.Inventory}?tab=purchases`, label: t("nav.purchases"), subtitle: t("mobile.more.purchasesHint") },
      { href: `${Routes.Inventory}?tab=stock`, label: t("nav.stocktakes"), subtitle: t("mobile.more.stocktakesHint") },
    ] : []),
    { href: Routes.Library, label: t("nav.library"), subtitle: t("mobile.more.libraryHint") },
    ...(sales && context.features.camera_quote_builder ? [{ href: Routes.CameraQuote, label: t("mobile.more.cameraQuote"), subtitle: t("mobile.more.cameraQuoteHint"), external: true }] : []),
    ...(sales && context.features.hunonic_price_list ? [{ href: Routes.HunonicPriceList, label: t("mobile.more.hunonicPriceList"), subtitle: t("mobile.more.hunonicPriceListHint"), external: true }] : []),
    ...(sales && context.features.rang_dong_price_list ? [{ href: Routes.RangDongSmartPriceList, label: t("mobile.more.rangDongPriceList"), subtitle: t("mobile.more.rangDongPriceListHint"), external: true }] : []),
    ...(manager ? [{ href: Routes.Finance, label: t("nav.groups.finance"), subtitle: t("mobile.more.financeHint") }] : []),
    ...(sales ? [{ href: `${Routes.Sales}?tab=returns`, label: t("nav.returns"), subtitle: t("mobile.more.returnsHint") }] : []),
    ...(sales && SHIFT_MANAGEMENT_UI_ENABLED ? [{ href: `${Routes.Finance}?tab=shifts`, label: t("nav.shifts"), subtitle: t("mobile.more.shiftHint") }] : []),
    ...(context.features.ai_assistant && store.prefs.ai.openaiApiKeySet ? [{ href: "/ai", label: t("nav.ai"), subtitle: t("mobile.more.aiHint") }] : []),
    { href: Routes.Tools, label: t("nav.tools"), subtitle: t("mobile.more.toolsHint") },
    ...(manager ? [
      { href: Routes.Settings, label: t("nav.settings"), subtitle: t("mobile.more.settingsHint") },
      { href: Routes.PrintSettings, label: t("mobile.more.printTemplates"), subtitle: t("mobile.more.printTemplatesHint") },
    ] : []),
    ...(sales ? [{ href: Routes.POS, label: t("nav.pos"), subtitle: t("mobile.more.posHint") }] : []),
  ];


  return (
    <div className="min-h-full bg-canvas lg:p-6">
      <MobileTopBar title={t("nav.more")} subtitle={store.name ?? t("common.appName")} />

      <div className="mx-auto max-w-2xl space-y-5 px-3 py-4 lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-6">
        <section className="rounded-2xl border border-border bg-surface p-3 shadow-e1">
          <div className="flex items-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary-50 text-primary-700 dark:bg-primary-950/50 dark:text-primary-300">
              <Store className="h-6 w-6" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-base font-black">{store.name ?? t("common.appName")}</div>
              <div className="truncate text-xs font-medium text-slate-400">{user.email} · {role}</div>
            </div>
          </div>
        </section>

        <MobileMoreQuickSearch
          entries={searchEntries}
          searchLabel={t("common.search")}
          emptyLabel={t("common.noResults")}
          clearLabel={t("common.clear")}
        >
        <MoreSection title={t("nav.groups.overview")}>
          <MobileSettingsRow href={Routes.Notifications} icon={Bell} label={t("nav.notifications")} subtitle={t("mobile.more.notificationsHint")} tone="orange" />
          {manager && <MobileSettingsRow href={Routes.Reports} icon={BarChart3} label={t("nav.reports")} subtitle={t("mobile.more.reportsHint")} tone="blue" />}
        </MoreSection>

        <MoreSection title={t("nav.groups.partners")}>
          {sales && <MobileSettingsRow href={Routes.Customers} icon={Users} label={t("nav.customers")} subtitle={t("mobile.more.customersHint")} tone="purple" />}
          {stock && <MobileSettingsRow href={Routes.Suppliers} icon={Truck} label={t("nav.suppliers")} subtitle={t("mobile.more.suppliersHint")} />}
          {sales && <MobileSettingsRow href={Routes.Projects} icon={BriefcaseBusiness} label={t("nav.projects")} subtitle={t("mobile.more.projectsHint")} />}
        </MoreSection>

        {stock && (
          <MoreSection title={t("nav.groups.inventory")}>
            <MobileSettingsRow href={`${Routes.Inventory}?tab=products`} icon={PackageSearch} label={t("nav.products")} subtitle={t("mobile.more.productsHint")} tone="blue" />
            <MobileSettingsRow href={`${Routes.Inventory}?tab=purchases`} icon={ShoppingCart} label={t("nav.purchases")} subtitle={t("mobile.more.purchasesHint")} />
            <MobileSettingsRow href={`${Routes.Inventory}?tab=stock`} icon={ClipboardCheck} label={t("nav.stocktakes")} subtitle={t("mobile.more.stocktakesHint")} tone="orange" />
          </MoreSection>
        )}

        <MoreSection title={t("nav.groups.manage")}>
          <MobileSettingsRow href={Routes.Library} icon={Images} label={t("nav.library")} subtitle={t("mobile.more.libraryHint")} tone="purple" />
          {sales && context.features.camera_quote_builder && <MobileSettingsRow href={Routes.CameraQuote} icon={Camera} label={t("mobile.more.cameraQuote")} subtitle={t("mobile.more.cameraQuoteHint")} tone="blue" target="_blank" />}
          {sales && context.features.hunonic_price_list && <MobileSettingsRow href={Routes.HunonicPriceList} icon={Cpu} label={t("mobile.more.hunonicPriceList")} subtitle={t("mobile.more.hunonicPriceListHint")} tone="orange" target="_blank" />}
          {sales && context.features.rang_dong_price_list && <MobileSettingsRow href={Routes.RangDongSmartPriceList} icon={Lightbulb} label={t("mobile.more.rangDongPriceList")} subtitle={t("mobile.more.rangDongPriceListHint")} tone="red" target="_blank" />}
          {manager && <MobileSettingsRow href={Routes.Finance} icon={Wallet} label={t("nav.groups.finance")} subtitle={t("mobile.more.financeHint")} />}
          {sales && <MobileSettingsRow href={`${Routes.Sales}?tab=returns`} icon={RotateCcw} label={t("nav.returns")} subtitle={t("mobile.more.returnsHint")} tone="red" />}
          {sales && SHIFT_MANAGEMENT_UI_ENABLED && <MobileSettingsRow href={`${Routes.Finance}?tab=shifts`} icon={Clock3} label={t("nav.shifts")} subtitle={t("mobile.more.shiftHint")} tone="orange" />}
          {context.features.ai_assistant && store.prefs.ai.openaiApiKeySet && <MobileSettingsRow href="/ai" icon={Sparkles} label={t("nav.ai")} subtitle={t("mobile.more.aiHint")} tone="purple" />}
        </MoreSection>

        <MoreSection title={t("nav.groups.system")}>
          <MobileSettingsRow href={Routes.Tools} icon={Wrench} label={t("nav.tools")} subtitle={t("mobile.more.toolsHint")} tone="blue" />
          {manager && <MobileSettingsRow href={Routes.Settings} icon={Settings} label={t("nav.settings")} subtitle={t("mobile.more.settingsHint")} />}
          {manager && <MobileSettingsRow href={Routes.PrintSettings} icon={Printer} label={t("mobile.more.printTemplates")} subtitle={t("mobile.more.printTemplatesHint")} tone="orange" />}
          {sales && <MobileSettingsRow href={Routes.POS} icon={UserRoundCog} label={t("nav.pos")} subtitle={t("mobile.more.posHint")} />}
        </MoreSection>

        <section className="space-y-2">
          <MobileSectionLabel>{t("mobile.more.preferences")}</MobileSectionLabel>
          <div className="space-y-2 rounded-2xl border border-border bg-surface p-3 shadow-e1">
            <ModeSwitcher current={mode} />
            <ThemeSwitcher current={theme} />
            <LanguageSwitcher />
            <LogoutButton userId={user.id} />
          </div>
        </section>
        </MobileMoreQuickSearch>
      </div>
    </div>
  );
}

function MoreSection({ title, children }: { title: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="space-y-2">
      <MobileSectionLabel>{title}</MobileSectionLabel>
      <div className="overflow-hidden rounded-2xl border border-border bg-surface">{children}</div>
    </section>
  );
}
