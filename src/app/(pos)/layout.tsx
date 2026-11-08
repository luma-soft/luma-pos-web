import { redirect } from "next/navigation";
import { requireUser } from "@/lib/actions/common";
import { resolveStoreContextForUser } from "@/lib/auth/store-context";
import { Routes } from "@/lib/routes";
import { ProductCatalogProvider } from "@/components/product-catalog-provider";
import { AppDataSyncProvider } from "@/components/app-data-sync-provider";
import { MobileTabBar } from "@/components/mobile-tabbar";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { TenantClientScopeProvider } from "@/components/tenant-client-scope";
import { productCatalogScopeId } from "@/lib/product-catalog";
import { getProductSortPreference } from "@/lib/product-sort-preference-server";
import { randomUUID } from "node:crypto";

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
  const [storeContext, locale, messages] = await Promise.all([
    resolveStoreContextForUser(user.id),
    getLocale(),
    getMessages(),
  ]);
  if (!storeContext) redirect(Routes.Login);
  const role = storeContext.role;
  const catalogScopeId = productCatalogScopeId(storeContext.storeId, user.id, role);
  const initialDefaultSort = await getProductSortPreference(storeContext.storeId, role);

  return (
    <NextIntlClientProvider locale={locale} messages={messages}>
      <TenantClientScopeProvider scopeId={catalogScopeId}>
        <AppDataSyncProvider revision={randomUUID()}>
          <ProductCatalogProvider key={catalogScopeId} userId={user.id} scopeId={catalogScopeId} initialDefaultSort={initialDefaultSort}>
            <div className="h-dvh overflow-hidden bg-canvas pb-[calc(4rem+env(safe-area-inset-bottom))] lg:pb-0">
              {children}
              <MobileTabBar role={role} />
            </div>
          </ProductCatalogProvider>
        </AppDataSyncProvider>
      </TenantClientScopeProvider>
    </NextIntlClientProvider>
  );
}
