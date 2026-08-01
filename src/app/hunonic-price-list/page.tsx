import type { Metadata } from "next";
import { getRole } from "@/lib/actions/common";
import { BrandPriceListClient } from "../(app)/brand-price-list/brand-price-list-client";
import { getBrandPriceListProducts } from "@/lib/data/brand-price-lists";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bảng giá thiết bị Hunonic | Hải Đăng Tech",
  description:
    "Bảng giá thiết bị nhà thông minh Hunonic chính hãng: công tắc cảm ứng, thiết bị an toàn và giải pháp điều khiển.",
  openGraph: {
    title: "Bảng giá thiết bị Hunonic | Hải Đăng Tech",
    description:
      "Công tắc cảm ứng, thiết bị an toàn và giải pháp nhà thông minh Hunonic chính hãng.",
    type: "website",
    locale: "vi_VN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bảng giá thiết bị Hunonic | Hải Đăng Tech",
    description:
      "Công tắc cảm ứng, thiết bị an toàn và giải pháp nhà thông minh Hunonic chính hãng.",
  },
};

export default async function HunonicPriceListPage() {
  const [products, supabase] = await Promise.all([
    getBrandPriceListProducts(["Hunonic"]),
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
      brand="Hunonic"
      eyebrow="Giải pháp nhà thông minh"
      title="Bảng giá thiết bị Hunonic"
      subtitle="Công tắc cảm ứng, thiết bị an toàn và hệ sinh thái điều khiển nhà thông minh Hunonic chính hãng."
      products={products}
      canEdit={canEdit}
      palette={{ ink: "#183348", accent: "#ef6b2e", soft: "#fff0e7", stripe: "#ef6b2e" }}
    />
  );
}
