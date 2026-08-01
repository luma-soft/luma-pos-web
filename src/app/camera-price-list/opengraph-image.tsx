import { ImageResponse } from "next/og";
import { PriceListOgImage } from "@/components/price-list-og-image";

export const alt = "Bảng giá lắp đặt camera | Hải Đăng Tech";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OpenGraphImage() {
  return new ImageResponse(
    <PriceListOgImage
      eyebrow="CAMERA CHÍNH HÃNG"
      title="Bảng giá lắp đặt camera"
      description="Thông số chi tiết và thẻ nhớ 32GB, 64GB, 128GB, 512GB."
      accent="#078a82"
      soft="#e1f1f1"
    />,
    size,
  );
}
