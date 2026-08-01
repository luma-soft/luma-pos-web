import { ImageResponse } from "next/og";
import { PriceListOgImage } from "@/components/price-list-og-image";

export const alt = "Bảng giá Rạng Đông Smart | Hải Đăng Tech";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <PriceListOgImage
      eyebrow="CHIẾU SÁNG THÔNG MINH"
      title="Bảng giá Rạng Đông Smart"
      description="Thiết bị chiếu sáng tiết kiệm năng lượng và giải pháp nhà thông minh chính hãng."
      accent="#e31e24"
      soft="#fff0f0"
    />,
    size,
  );
}
