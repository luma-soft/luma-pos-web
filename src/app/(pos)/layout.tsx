import { redirect } from "next/navigation";
import { getRole, requireUser } from "@/lib/actions/common";
import { Routes } from "@/lib/routes";
import { ProductCatalogProvider } from "@/components/product-catalog-provider";
import { MobileTabBar } from "@/components/mobile-tabbar";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { TenantClientScopeProvider } from "@/components/tenant-client-scope";

/**
 * Layout riêng cho màn bán hàng — full màn hình, KHÔNG có sidebar quản trị
 * (giống KiotViet). Vẫn yêu cầu đăng nhập.
 */
export default async function PosLayout({ children }: { children: React.ReactNode }) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    redirect(Routes.Login);
  }
  const [role, locale, messages] = await Promise.all([
    getRole(user.id),
    getLocale(),
    getMessages(),
  ]);
  const clientScopeId = `${user.id}:${role}`;

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <TenantClientScopeProvider scopeId={clientScopeId}>
        <ProductCatalogProvider userId={user.id} scopeId={clientScopeId}>
          <div className="h-dvh overflow-hidden bg-canvas pb-[calc(3.75rem+env(safe-area-inset-bottom))] lg:pb-0">
            {children}
            <MobileTabBar />
          </div>
        </ProductCatalogProvider>
      </TenantClientScopeProvider>
    </NextIntlClientProvider>
  );
}
