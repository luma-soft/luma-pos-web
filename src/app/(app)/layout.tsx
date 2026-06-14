import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { createClient } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/logout-button";
import { LanguageSwitcher } from "@/components/language-switcher";
import { ThemeSwitcher } from "@/components/theme-switcher";
import { ModeSwitcher } from "@/components/mode-switcher";
import { AppNav } from "@/components/app-nav";
import { SidebarToggle } from "@/components/sidebar-toggle";
import { MobileNavBackdrop } from "@/components/mobile-nav";
import { MobileTabBar } from "@/components/mobile-tabbar";
import { Routes } from "@/lib/routes";
import { getTheme, getMode } from "@/lib/theme/cookie";

// Tất cả trang khu vực app cần đăng nhập + dữ liệu DB → render lúc request,
// KHÔNG prerender lúc build (tránh query DB chạy lúc build → timeout trên Vercel).
export const dynamic = "force-dynamic";

// đặt trạng thái sidebar trước khi paint để tránh nháy
const SIDEBAR_INIT = `(function(){try{if(localStorage.getItem('sidebar-collapsed')==='1')document.documentElement.dataset.sidebar='collapsed';}catch(e){}})();`;

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(Routes.Login);

  const t = await getTranslations();
  const theme = await getTheme();
  const mode = await getMode();

  return (
    <div className="min-h-screen flex bg-canvas">
      <script dangerouslySetInnerHTML={{ __html: SIDEBAR_INIT }} />
      <MobileNavBackdrop />
      <aside className="app-sidebar w-60 shrink-0 bg-surface border-r border-border flex flex-col sticky top-0 h-screen overflow-hidden transition-[width,opacity,transform] duration-200">
        {/* brand — theo design: logo gradient + tên cửa hàng */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-border">
          <div className="w-9 h-9 rounded-xl shrink-0 grid place-items-center text-white font-extrabold bg-gradient-to-br from-primary-600 to-primary-400">
            S
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-bold leading-tight">{t("common.appName")}</h1>
            <p className="text-[11px] text-slate-400 truncate">{user.email}</p>
          </div>
          <SidebarToggle />
        </div>

        <AppNav />

        <div className="p-3 border-t border-border space-y-2">
          <ModeSwitcher current={mode} />
          <ThemeSwitcher current={theme} />
          <LanguageSwitcher />
          <LogoutButton />
        </div>
      </aside>

      <main className="flex-1 min-w-0 overflow-auto">
        <div className="hidden lg:block"><SidebarToggle variant="floating" /></div>
        <div className="pb-16 lg:pb-0">{children}</div>
        <MobileTabBar />
      </main>
    </div>
  );
}
