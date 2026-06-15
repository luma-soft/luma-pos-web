"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Sun, Moon, Monitor, Palette, Languages, LogOut, Check } from "lucide-react";
import { setMode, setTheme } from "@/lib/theme/cookie";
import { themes, themeMeta, modes, type Theme, type Mode } from "@/lib/theme/config";
import { setUserLocale } from "@/i18n/locale";
import type { Locale } from "@/i18n/config";
import { createClient } from "@/lib/supabase/client";
import { Routes } from "@/lib/routes";
import { cn } from "@/lib/utils";

const MODE_ICON = { light: Sun, dark: Moon, system: Monitor } as const;

/** Nút icon trong rail tối (light-on-dark). */
const RAIL_BTN =
  "w-11 h-11 rounded-[10px] grid place-items-center text-[rgba(250,250,248,0.4)] hover:text-[rgba(250,250,248,0.85)] hover:bg-white/[0.07] transition-colors relative";

/** Cụm điều khiển dưới rail: chế độ sáng/tối · theme · ngôn ngữ · đăng xuất. */
export function RailControls({ theme, mode }: { theme: Theme; mode: Mode }) {
  return (
    <div className="flex flex-col items-center gap-1">
      <ModeToggle current={mode} />
      <ThemePopover current={theme} />
      <LangPopover />
      <LogoutBtn />
    </div>
  );
}

function ModeToggle({ current }: { current: Mode }) {
  const t = useTranslations();
  const router = useRouter();
  const [active, setActive] = useState<Mode>(current);
  const [, start] = useTransition();
  const Icon = MODE_ICON[active];

  function cycle() {
    const next = modes[(modes.indexOf(active) + 1) % modes.length];
    setActive(next);
    const resolved = next === "system"
      ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
      : next;
    document.documentElement.setAttribute("data-mode", resolved);
    start(async () => { await setMode(next); router.refresh(); });
  }

  return (
    <button onClick={cycle} className={RAIL_BTN} title={t(`theme.mode.${active}`)} aria-label={t(`theme.mode.${active}`)}>
      <Icon className="w-5 h-5" />
    </button>
  );
}

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);
  return { open, setOpen, ref };
}

function ThemePopover({ current }: { current: Theme }) {
  const t = useTranslations();
  const router = useRouter();
  const { open, setOpen, ref } = usePopover();
  const [, start] = useTransition();
  function pick(th: Theme) {
    document.documentElement.setAttribute("data-theme", th);
    start(async () => { await setTheme(th); setOpen(false); router.refresh(); });
  }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className={RAIL_BTN} title={t("theme.title")} aria-label={t("theme.title")}>
        <Palette className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute bottom-0 left-full ml-2 w-44 bg-surface border border-border rounded-xl shadow-e2 p-1 z-70">
          {themes.map((th) => (
            <button key={th} onClick={() => pick(th)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 text-sm">
              <span className="w-3.5 h-3.5 rounded-full ring-1 ring-border shrink-0" style={{ background: themeMeta[th].swatch }} />
              <span className="flex-1 text-left">{themeMeta[th].label}</span>
              {current === th && <Check className="w-3.5 h-3.5 text-primary-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const LANGS: { code: Locale; label: string; flag: string }[] = [
  { code: "vi", label: "Tiếng Việt", flag: "🇻🇳" },
  { code: "en", label: "English", flag: "🇬🇧" },
];

function LangPopover() {
  const t = useTranslations();
  const locale = useLocale() as Locale;
  const router = useRouter();
  const { open, setOpen, ref } = usePopover();
  const [, start] = useTransition();
  function pick(code: Locale) {
    start(async () => { await setUserLocale(code); setOpen(false); router.refresh(); });
  }
  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} className={RAIL_BTN} title={t("common.language")} aria-label={t("common.language")}>
        <Languages className="w-5 h-5" />
      </button>
      {open && (
        <div className="absolute bottom-0 left-full ml-2 w-40 bg-surface border border-border rounded-xl shadow-e2 p-1 z-70">
          {LANGS.map((l) => (
            <button key={l.code} onClick={() => pick(l.code)} className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-2 text-sm">
              <span>{l.flag}</span>
              <span className="flex-1 text-left">{l.label}</span>
              {locale === l.code && <Check className="w-3.5 h-3.5 text-primary-600" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LogoutBtn() {
  const t = useTranslations();
  const router = useRouter();
  async function logout() {
    await createClient().auth.signOut();
    router.push(Routes.Login);
    router.refresh();
  }
  return (
    <button onClick={logout} className={cn(RAIL_BTN, "hover:text-er")} title={t("auth.logout")} aria-label={t("auth.logout")}>
      <LogOut className="w-5 h-5" />
    </button>
  );
}
