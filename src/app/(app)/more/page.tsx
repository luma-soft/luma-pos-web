import {
  BarChart3,
  BellDot,
  BookOpen,
  Building2,
  Camera,
  Clock3,
  Cpu,
  Images,
  Lightbulb,
  Settings,
  Sparkles,
  Truck,
  Users,
  Wallet,
  Wrench,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getRole, requireUser } from "@/lib/actions/common";
import { getStoreSettings } from "@/lib/data/settings";
import { Routes } from "@/lib/routes";
import { MobileListRow, MobileListSection, MobileTopBar } from "@/components/mobile-ui";
import { MobileMoreQuickSearch, type MobileMoreSearchEntry } from "@/components/mobile-more-quick-search";
import { ModeSwitcher } from "@/components/mode-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { MobileLogoutRow } from "@/components/logout-button";
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
    ...(manager ? [
      { href: Routes.Finance, label: t("nav.groups.finance"), subtitle: t("mobile.more.financeHint") },
      { href: Routes.Accounting, label: t("mobile.more.accountingTax") },
    ] : []),
    ...(sales && context.features.field_services ? [{ href: Routes.Services, label: t("mobile.more.serviceJobs") }] : []),
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


  const services = sales && context.features.field_services;

  // Section order and grouping mirror MoreView.swift. Inventory, POS and returns
  // live in their own tabs on iOS, so they are only reachable through search here.
  return (
    <div className="min-h-full bg-canvas lg:p-6">
      <MobileTopBar title={t("nav.more")} />

      <div className="mx-auto max-w-2xl px-ios-inset pb-6 lg:rounded-card lg:border lg:border-border lg:bg-surface lg:p-6">
        <MobileMoreQuickSearch
          entries={searchEntries}
          searchLabel={t("mobile.more.searchPrompt")}
          emptyLabel={t("mobile.more.noResultsTitle")}
          clearLabel={t("common.clear")}
        >
          {(sales || stock) && (
            <MobileListSection title={t("nav.groups.partners")}>
              {sales && <MobileListRow href={Routes.Customers} icon={Users} title={t("nav.customers")} />}
              {stock && <MobileListRow href={Routes.Suppliers} icon={Truck} title={t("nav.suppliers")} />}
            </MobileListSection>
          )}

          <MobileListSection>
            <MobileListRow href={Routes.Notifications} icon={BellDot} title={t("nav.notifications")} />
            {manager && <MobileListRow href={Routes.Reports} icon={BarChart3} title={t("nav.reports")} />}
            {manager && <MobileListRow href={`${Routes.Finance}?tab=summary`} icon={Wallet} title={t("nav.groups.finance")} />}
            {manager && <MobileListRow href={Routes.Accounting} icon={BookOpen} title={t("mobile.more.accountingTax")} />}
          </MobileListSection>

          {sales && (
            <MobileListSection>
              {services && <MobileListRow href={Routes.Services} icon={Wrench} title={t("mobile.more.serviceJobs")} />}
              <MobileListRow href={Routes.Projects} icon={Building2} title={t("nav.projects")} />
            </MobileListSection>
          )}

          <MobileListSection title={t("nav.tools")}>
            <MobileListRow href={Routes.Tools} icon={Wrench} title={t("nav.tools")} />
            {sales && context.features.camera_quote_builder && <MobileListRow href={Routes.CameraQuote} icon={Camera} title={t("mobile.more.cameraQuote")} subtitle={t("mobile.more.cameraQuoteHint")} target="_blank" />}
            {sales && context.features.hunonic_price_list && <MobileListRow href={Routes.HunonicPriceList} icon={Cpu} title={t("mobile.more.hunonicPriceList")} subtitle={t("mobile.more.hunonicPriceListHint")} target="_blank" />}
            {sales && context.features.rang_dong_price_list && <MobileListRow href={Routes.RangDongSmartPriceList} icon={Lightbulb} title={t("mobile.more.rangDongPriceList")} subtitle={t("mobile.more.rangDongPriceListHint")} target="_blank" />}
          </MobileListSection>

          {context.features.ai_assistant && store.prefs.ai.openaiApiKeySet && (
            <MobileListSection title="AI">
              <MobileListRow href="/ai" icon={Sparkles} title={t("nav.ai")} />
            </MobileListSection>
          )}

          <MobileListSection title={t("nav.groups.system")}>
            <MobileListRow href={Routes.Library} icon={Images} title={t("nav.library")} />
          </MobileListSection>

          {sales && SHIFT_MANAGEMENT_UI_ENABLED && (
            <MobileListSection title={t("nav.shifts")}>
              <MobileListRow href={`${Routes.Finance}?tab=shifts`} icon={Clock3} title={t("nav.shifts")} />
            </MobileListSection>
          )}

          {/* iOS keeps appearance in Settings; staff without Settings access keep it here. */}
          {!manager && <MobileListSection title={t("mobile.more.preferences")}>
            <div className="space-y-2 p-4">
              <ModeSwitcher current={mode} />
              <ThemeSwitcher current={theme} />
              <LanguageSwitcher />
            </div>
          </MobileListSection>}

          <MobileListSection title={t("mobile.more.account")}>
            {manager && <MobileListRow href={Routes.Settings} icon={Settings} title={t("nav.settings")} />}
            <MobileLogoutRow userId={user.id} />
          </MobileListSection>
        </MobileMoreQuickSearch>
      </div>
    </div>
  );
}
