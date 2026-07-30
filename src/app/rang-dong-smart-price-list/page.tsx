import { getRole } from "@/lib/actions/common";
import { BrandPriceListClient } from "../(app)/brand-price-list/brand-price-list-client";
import { getBrandPriceListProducts } from "@/lib/data/brand-price-lists";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function RangDongSmartPriceListPage() {
  const [products, supabase] = await Promise.all([
    getBrandPriceListProducts(["Rạng Đông Smart", "Rạng Đông"]),
    createClient(),
  ]);
  const { data: { user } } = await supabase.auth.getUser();
  let canEdit = false;
  if (user) {
    try {
      const role = await getRole(user.id);
      canEdit = role === "owner" || role === "manager";
    } catch {
      // Public visitors only view and copy the published catalog prices.
    }
  }

  return (
    <BrandPriceListClient
      brand="Rạng Đông Smart"
      eyebrow="Chiếu sáng thông minh"
      title="Bảng giá Rạng Đông Smart"
      subtitle="Thiết bị chiếu sáng và giải pháp nhà thông minh Rạng Đông: chính hãng, tiết kiệm năng lượng, dễ dàng vận hành."
      products={products}
      canEdit={canEdit}
      palette={{ ink: "#17365d", accent: "#e31e24", soft: "#fff0f0", stripe: "#e31e24" }}
    />
  );
}
