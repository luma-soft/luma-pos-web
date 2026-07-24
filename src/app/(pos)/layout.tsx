import { redirect } from "next/navigation";
import { getRole, requireUser } from "@/lib/actions/common";
import { Routes } from "@/lib/routes";
import { ProductCatalogProvider } from "@/components/product-catalog-provider";

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
  const role = await getRole(user.id);

  return (
    <ProductCatalogProvider userId={user.id} scopeId={`${user.id}:${role}`}>
      <div className="h-dvh overflow-hidden bg-canvas">
        {children}
      </div>
    </ProductCatalogProvider>
  );
}
