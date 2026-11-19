"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowUpDown,
  BellDot,
  Check,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  FileText,
  Languages,
  MessageCircle,
  Palette,
  Percent,
  Printer,
  Puzzle,
  ShoppingCart,
  Sparkles,
  Store,
  Video,
  type LucideIcon,
} from "lucide-react";
import { MobileActionSheet } from "@/components/mobile-detail-nav";
import { MobileListSection, mobileListRowClass } from "@/components/mobile-ui";
import { setUserLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/config";
import { MODE_COOKIE, THEME_COOKIE, themeMeta, themes, type Theme } from "@/lib/theme/config";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

export type SettingsMobileSection = "store" | "offline" | "pos" | "productBrowse" | "cameraQuote" | "hardware" | "payments" | "print" | "tax" | "notifications" | "zalo" | "shopee" | "ai";

const circle = "grid size-11 shrink-0 place-items-center rounded-full border border-black/[0.06] bg-surface/90 shadow-[0_2px_10px_rgb(0_0_0/0.08)] backdrop-blur-md dark:border-white/10";

/** iOS 26 navigation bar for settings screens: circular back button and a centred title. */
export function SettingsMobileNavBar({ title, onBack, backHref }: { title: string; onBack?: () => void; backHref?: string }) {
  const t = useTranslations();
  const back = <ChevronLeft className="size-6" strokeWidth={2.4} aria-hidden="true" />;
  return (
    <header className="sticky top-0 z-20 grid grid-cols-[44px_minmax(0,1fr)_44px] items-center gap-2 bg-canvas/85 px-ios-inset pb-2 pt-[calc(env(safe-area-inset-top)+0.5rem)] backdrop-blur-xl lg:hidden">
      {backHref ? (
        <Link href={backHref} aria-label={t("common.back")} data-button-radius="pill" className={`${circle} text-ios-label`}>{back}</Link>
      ) : (
        <button type="button" onClick={onBack} aria-label={t("common.back")} data-button-radius="pill" className={`${circle} text-ios-label`}>{back}</button>
      )}
      <h1 className="truncate text-center text-[17px] font-semibold">{title}</h1>
      <span aria-hidden="true" />
    </header>
  );
}

function IosSwitch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (next: boolean) => void; label: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      data-button-radius="pill"
      className={cn("relative h-[28px] w-[62px] shrink-0 rounded-full transition-colors disabled:opacity-50", checked ? "bg-ios-accent" : "bg-black/[0.12] dark:bg-white/20")}
    >
      <span className={cn("absolute top-[2px] h-6 w-[38px] rounded-full bg-white shadow-[0_2px_6px_rgb(0_0_0/0.18)] transition-[left]", checked ? "left-[22px]" : "left-[2px]")} />
    </button>
  );
}

function NavRow({ icon: Icon, title, onSelect }: { icon: LucideIcon; title: string; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={mobileListRowClass}>
      <Icon className="size-[24px] shrink-0 text-ios-accent" strokeWidth={1.9} aria-hidden="true" />
      <span className="flex min-h-[62px] min-w-0 flex-1 items-center gap-2 border-b border-border py-2.5 pr-ios-inset group-last:border-b-0">
        <span className="min-w-0 flex-1 truncate text-[17px] leading-[22px]">{title}</span>
        <ChevronRight className="size-[17px] shrink-0 text-ios-label-tertiary" strokeWidth={2.5} aria-hidden="true" />
      </span>
    </button>
  );
}

/** Row with a tinted circular icon, caption and an accent value (NativeSettingsValueRow). */
function ValueRow({ icon: Icon, title, subtitle, value, onSelect }: { icon: LucideIcon; title: string; subtitle: string; value: string; onSelect: () => void }) {
  return (
    <button type="button" onClick={onSelect} className={mobileListRowClass}>
      <span className="grid size-[38px] shrink-0 place-items-center rounded-full bg-ios-accent/12 text-ios-accent">
        <Icon className="size-[20px]" strokeWidth={2.2} aria-hidden="true" />
      </span>
      <span className="flex min-h-[62px] min-w-0 flex-1 items-center gap-2 border-b border-border py-3 pr-ios-inset group-last:border-b-0">
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] leading-[22px]">{title}</span>
          <span className="mt-0.5 block text-[15px] leading-5 text-ios-label-secondary">{subtitle}</span>
        </span>
        <span className="max-w-[40%] shrink-0 truncate text-[17px] font-medium text-ios-accent">{value}</span>
        <ChevronRight className="size-[17px] shrink-0 text-ios-label-tertiary" strokeWidth={2.5} aria-hidden="true" />
      </span>
    </button>
  );
}

function ToggleRow({ title, subtitle, checked, onChange }: { title: string; subtitle: string; checked: boolean; onChange: (next: boolean) => void }) {
  return (
    <div className="group flex w-full items-center pl-ios-inset">
      <span className="flex min-h-[62px] min-w-0 flex-1 items-center gap-3 border-b border-border py-3 pr-ios-inset group-last:border-b-0">
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] leading-[22px]">{title}</span>
          <span className="mt-0.5 block text-[15px] leading-5 text-ios-label-secondary">{subtitle}</span>
        </span>
        <IosSwitch checked={checked} onChange={onChange} label={title} />
      </span>
    </div>
  );
}

function readAttribute(name: string) {
  return document.documentElement.getAttribute(name) ?? "";
}

/** Re-renders when <html> data-mode / data-theme change. */
function subscribeRoot(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-mode", "data-theme"] });
  return () => observer.disconnect();
}

function persistCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * Settings root on phones (NativeSettingsView): store, device, quote, product
 * browsing and app groups with the iOS rows, plus the web-only sections at the end.
 */
export function SettingsMobileRoot({
  visible,
  onPick,
  productSortLabel,
  offline,
}: {
  visible: (id: SettingsMobileSection) => boolean;
  onPick: (id: SettingsMobileSection) => void;
  productSortLabel: string;
  offline: { available: boolean; enabled: boolean; onChange: (next: boolean) => void };
}) {
  const t = useTranslations("mobile.settings");
  const locale = useLocale() as Locale;
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [sheet, setSheet] = useState<"theme" | "language" | null>(null);
  const mode = useSyncExternalStore(subscribeRoot, () => readAttribute("data-mode"), () => "");
  const theme = (useSyncExternalStore(subscribeRoot, () => readAttribute("data-theme"), () => "luma") || "luma") as Theme;

  const setDark = (dark: boolean) => {
    const next = dark ? "dark" : "light";
    document.documentElement.setAttribute("data-mode", next);
    persistCookie(MODE_COOKIE, next);
  };
  const setTheme = (next: Theme) => {
    document.documentElement.setAttribute("data-theme", next);
    persistCookie(THEME_COOKIE, next);
    setSheet(null);
  };
  const setLanguage = (next: Locale) => {
    setSheet(null);
    if (next === locale) return;
    startTransition(async () => {
      await setUserLocale(next);
      router.refresh();
    });
  };

  const row = (id: SettingsMobileSection, icon: LucideIcon, title: string) =>
    visible(id) ? <NavRow key={id} icon={icon} title={title} onSelect={() => onPick(id)} /> : null;
  const storeRows = [row("store", Store, t("storeProfile")), row("tax", Percent, t("tax")), row("payments", CreditCard, t("payments")), row("print", FileText, t("printTemplates"))].filter(Boolean);
  const deviceRows = [row("hardware", Printer, t("printers")), row("notifications", BellDot, t("push"))].filter(Boolean);
  const otherRows = [row("pos", ShoppingCart, t("pos")), row("zalo", MessageCircle, t("zalo")), row("shopee", Puzzle, t("shopee")), row("ai", Sparkles, t("ai"))].filter(Boolean);

  return (
    <div className="min-h-full bg-canvas lg:hidden">
      <SettingsMobileNavBar title={t("title")} backHref={Routes.More} />
      <div className="space-y-ios-section px-ios-inset pb-[calc(5rem+env(safe-area-inset-bottom))] pt-2 [&_h2]:px-ios-inset [&_h2]:text-[17px] [&_h2]:font-normal">
        {storeRows.length > 0 && <MobileListSection title={t("groupStore")}>{storeRows}</MobileListSection>}
        {deviceRows.length > 0 && <MobileListSection title={t("groupDevices")}>{deviceRows}</MobileListSection>}
        {visible("cameraQuote") && <MobileListSection title={t("groupQuotes")}>{row("cameraQuote", Video, t("cameraQuote"))}</MobileListSection>}
        {visible("productBrowse") && (
          <MobileListSection title={t("groupProducts")}>
            <ValueRow icon={ArrowUpDown} title={t("productSort")} subtitle={t("productSortHint")} value={productSortLabel} onSelect={() => onPick("productBrowse")} />
          </MobileListSection>
        )}
        <MobileListSection title={t("groupApp")}>
          <ValueRow icon={Palette} title={t("theme")} subtitle={t("themeHint")} value={themeMeta[theme]?.label ?? themeMeta.luma.label} onSelect={() => setSheet("theme")} />
          <ValueRow icon={Languages} title={t("language")} subtitle={t("languageHint")} value={locale === "vi" ? "Tiếng Việt" : "English"} onSelect={() => setSheet("language")} />
          <ToggleRow title={t("darkMode")} subtitle={t("darkModeHint")} checked={mode === "dark"} onChange={setDark} />
          {offline.available && <ToggleRow title={t("offline")} subtitle={t("offlineHint")} checked={offline.enabled} onChange={offline.onChange} />}
        </MobileListSection>
        {otherRows.length > 0 && <MobileListSection title={t("groupOther")}>{otherRows}</MobileListSection>}
      </div>

      <MobileActionSheet open={sheet === "theme"} onClose={() => setSheet(null)} title={t("theme")}>
        <div className="space-y-2">
          {themes.map((item) => (
            <button key={item} type="button" onClick={() => setTheme(item)} className="flex h-12 w-full items-center gap-3 rounded-[14px] bg-surface px-4 text-left text-[17px]">
              <span className="size-5 shrink-0 rounded-full ring-1 ring-black/10" style={{ background: themeMeta[item].swatch }} aria-hidden="true" />
              <span className="flex-1">{themeMeta[item].label}</span>
              {theme === item && <Check className="size-5 text-ios-accent" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </MobileActionSheet>
      <MobileActionSheet open={sheet === "language"} onClose={() => setSheet(null)} title={t("language")}>
        <div className="space-y-2">
          {([["vi", "Tiếng Việt"], ["en", "English"]] as const).map(([code, label]) => (
            <button key={code} type="button" onClick={() => setLanguage(code)} className="flex h-12 w-full items-center gap-3 rounded-[14px] bg-surface px-4 text-left text-[17px]">
              <span className="flex-1">{label}</span>
              {locale === code && <Check className="size-5 text-ios-accent" aria-hidden="true" />}
            </button>
          ))}
        </div>
      </MobileActionSheet>
    </div>
  );
}
