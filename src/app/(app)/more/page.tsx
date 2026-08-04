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
  Utensils,
  Printer,
} from "lucide-react";
import { getTranslations } from "next-intl/server";
import { getRole, requireUser } from "@/lib/actions/common";
import { getStoreSettings } from "@/lib/data/settings";
import { Routes } from "@/lib/routes";
import { MobileSectionLabel, MobileSettingsRow, MobileTopBar } from "@/components/mobile-ui";
import { ModeSwitcher } from "@/components/mode-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { LanguageSwitcher } from "@/components/language-switcher";
import { LogoutButton } from "@/components/logout-button";
import { getMode, getTheme } from "@/lib/theme/cookie";

export const dynamic = "force-dynamic";

export default async function MorePage() {
  const user = await requireUser();
  const [role, store, t, mode, theme] = await Promise.all([
    getRole(user.id),
    getStoreSettings(),
    getTranslations(),
    getMode(),
    getTheme(),
  ]);
  const manager = role === "owner" || role === "manager";
  const stock = manager || role === "warehouse";
  const sales = manager || role === "cashier";
  const fnb = store.industry === "restaurant" || store.industry === "cafe";

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
            <MobileSettingsRow href={`${Routes.Inventory}?tab=stocktakes`} icon={ClipboardCheck} label={t("nav.stocktakes")} subtitle={t("mobile.more.stocktakesHint")} tone="orange" />
          </MoreSection>
        )}

        {(manager || sales) && (
          <MoreSection title={t("nav.groups.manage")}>
            {sales && <MobileSettingsRow href={Routes.CameraQuote} icon={Camera} label={t("mobile.more.cameraQuote")} subtitle={t("mobile.more.cameraQuoteHint")} tone="blue" target="_blank" />}
            {sales && <MobileSettingsRow href={Routes.HunonicPriceList} icon={Cpu} label={t("mobile.more.hunonicPriceList")} subtitle={t("mobile.more.hunonicPriceListHint")} tone="orange" target="_blank" />}
            {sales && <MobileSettingsRow href={Routes.RangDongSmartPriceList} icon={Lightbulb} label={t("mobile.more.rangDongPriceList")} subtitle={t("mobile.more.rangDongPriceListHint")} tone="red" target="_blank" />}
            {sales && fnb && <MobileSettingsRow href={Routes.Tables} icon={Utensils} label={t("nav.tables")} subtitle={t("mobile.more.tablesHint")} tone="orange" />}
            {manager && <MobileSettingsRow href={Routes.Finance} icon={Wallet} label={t("nav.groups.finance")} subtitle={t("mobile.more.financeHint")} />}
            {sales && <MobileSettingsRow href={`${Routes.Sales}?tab=returns`} icon={RotateCcw} label={t("nav.returns")} subtitle={t("mobile.more.returnsHint")} tone="red" />}
            {sales && <MobileSettingsRow href={`${Routes.Finance}?tab=shifts`} icon={Clock3} label={t("nav.shifts")} subtitle={t("mobile.more.shiftHint")} tone="orange" />}
            {store.prefs.ai.openaiApiKeySet && <MobileSettingsRow href="/ai" icon={Sparkles} label={t("nav.ai")} subtitle={t("mobile.more.aiHint")} tone="purple" />}
          </MoreSection>
        )}

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
