import { ImageResponse } from "next/og";
import { PriceListOgImage } from "@/components/price-list-og-image";

export const alt = "Bảng giá thiết bị Hunonic | Hải Đăng Tech";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <PriceListOgImage
      eyebrow="NHÀ THÔNG MINH"
      title="Bảng giá thiết bị Hunonic"
      description="Công tắc cảm ứng, thiết bị an toàn và hệ sinh thái nhà thông minh chính hãng."
      accent="#ef6b2e"
      soft="#fff0e7"
    />,
    size,
  );
}
