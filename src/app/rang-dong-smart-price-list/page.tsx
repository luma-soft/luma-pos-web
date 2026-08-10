import type { Metadata } from "next";
import { getRole } from "@/lib/actions/common";
import { BrandPriceListClient } from "../(app)/brand-price-list/brand-price-list-client";
import { getBrandPriceListProducts } from "@/lib/data/brand-price-lists";
import { createClient } from "@/lib/supabase/server";
import { notFound } from "next/navigation";
import { resolveLegacyCurrentPublicStore } from "@/lib/tenancy/public-store";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bảng giá Rạng Đông Smart | Hải Đăng Tech",
  description:
    "Bảng giá thiết bị chiếu sáng và nhà thông minh Rạng Đông Smart chính hãng.",
  openGraph: {
    title: "Bảng giá Rạng Đông Smart | Hải Đăng Tech",
    description:
      "Thiết bị chiếu sáng tiết kiệm năng lượng và giải pháp nhà thông minh Rạng Đông Smart chính hãng.",
    type: "website",
    locale: "vi_VN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bảng giá Rạng Đông Smart | Hải Đăng Tech",
    description:
      "Thiết bị chiếu sáng tiết kiệm năng lượng và giải pháp nhà thông minh Rạng Đông Smart chính hãng.",
  },
};

export default async function RangDongSmartPriceListPage() {
  const store = await resolveLegacyCurrentPublicStore("rang_dong_price_list");
  if (!store) notFound();
  const [products, supabase] = await Promise.all([getBrandPriceListProducts(store.id, ["Rạng Đông Smart", "Rạng Đông"]), createClient()]);
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
