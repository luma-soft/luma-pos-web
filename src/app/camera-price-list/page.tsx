import type { Metadata } from "next";
import { getRole } from "@/lib/actions/common";
import { getCameraQuoteFormOptions } from "@/lib/data/camera-quotes";
import { createClient } from "@/lib/supabase/server";
import { CameraPriceListClient } from "../(app)/camera-price-list/camera-price-list-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Bảng giá lắp đặt camera | Hải Đăng Tech",
  description:
    "Bảng giá camera chính hãng, thông số chi tiết và các lựa chọn thẻ nhớ từ 32GB đến 512GB.",
  openGraph: {
    title: "Bảng giá lắp đặt camera | Hải Đăng Tech",
    description:
      "Camera chính hãng, thông số chi tiết và các lựa chọn thẻ nhớ từ 32GB đến 512GB.",
    type: "website",
    locale: "vi_VN",
  },
  twitter: {
    card: "summary_large_image",
    title: "Bảng giá lắp đặt camera | Hải Đăng Tech",
    description:
      "Camera chính hãng, thông số chi tiết và các lựa chọn thẻ nhớ từ 32GB đến 512GB.",
  },
};

export default async function CameraPriceListPage() {
  const [options, supabase] = await Promise.all([getCameraQuoteFormOptions(), createClient()]);
  const { data: { user } } = await supabase.auth.getUser();
  let canEdit = false;
  if (user) {
    try { const role = await getRole(user.id); canEdit = role === "owner" || role === "manager"; } catch { /* guests only view */ }
  }
  const installationPrice = options.installations[0]?.retailPrice ?? 0;
  const materialPrice = options.materials[0]?.retailPrice ?? 0;
  const basePrice = installationPrice + materialPrice;
  const memoryOptions = options.cards.filter((card) =>
    ["32GB", "64GB", "128GB", "512GB"].includes(
      card.specs["Dung lượng"]?.[0] ?? "",
    ),
  );
  // Hikvision will be added once its package prices are finalised.
  const models = options.cameras
    .filter((camera) => !camera.name.toLocaleLowerCase("vi").includes("hikvision"))
    .map((camera) => {
      const maxStorageGb = cameraMaxStorageGb(camera.specs);
      const megapixels = cameraMegapixels(camera.specs);
      const compatibleCards = memoryOptions.filter((card) => {
        const capacityGb = memoryCardCapacityGb(card.specs);
        return maxStorageGb === null || capacityGb === null || capacityGb <= maxStorageGb;
      });
      const guidance = cameraGuidance(camera.name, camera.specs);
      return {
        id: camera.id,
        model: camera.name,
        description: camera.description ?? "Thiết bị camera chính hãng, phù hợp nhu cầu giám sát.",
        imageUrl: camera.imageUrl,
        specs: camera.specs,
        installationLocation: cameraInstallationLocation(camera.name, camera.specs),
        suitableFor: guidance.suitableFor,
        installationNotes: guidance.installationNotes,
        variants: compatibleCards.map((card) => ({
          id: `${camera.id}:${card.id}`,
          cameraId: camera.id,
          cardId: card.id,
          cameraPrice: camera.retailPrice,
          cardPrice: card.retailPrice,
          installationPrice,
          materialPrice,
          price: camera.retailPrice + card.retailPrice + basePrice,
          storageEstimate: estimateStorageDays(memoryCardCapacityGb(card.specs), megapixels),
        })),
      };
    });
  return <CameraPriceListClient
    models={models}
    memoryLabels={memoryOptions.map((card) => `Thẻ nhớ ${card.specs["Dung lượng"]?.[0] ?? card.name}`)}
    canEdit={canEdit}
  />;
}

function isOutdoorCamera(name: string, specs: Record<string, string[]>) {
  const specificationText = Object.values(specs).flat().join(" ");
  return /\bIP(?:65|66|67)\b/i.test(specificationText) || /\b(?:H3|H8|H9|H80|F32|K7)/i.test(name);
}

function cameraInstallationLocation(
  name: string,
  specs: Record<string, string[]>,
): "Trong nhà" | "Ngoài trời" {
  return isOutdoorCamera(name, specs) ? "Ngoài trời" : "Trong nhà";
}

function memoryCardCapacityGb(specs: Record<string, string[]>) {
  return storageCapacityGb(specs["Dung lượng"]?.join(" ") ?? "");
}

function cameraMaxStorageGb(specs: Record<string, string[]>) {
  return storageCapacityGb(specs["Nguồn / lưu trữ"]?.join(" ") ?? "");
}

function storageCapacityGb(value: string) {
  const capacities = (value.match(/\d+\s*GB/gi) ?? []).map((capacity) => Number.parseInt(capacity, 10));
  return capacities.length ? Math.max(...capacities) : null;
}

function cameraMegapixels(specs: Record<string, string[]>) {
  const megapixels = (specs["Độ phân giải"]?.join(" ").match(/\d+\s*MP/gi) ?? [])
    .map((value) => Number.parseInt(value, 10));
  return megapixels.length ? megapixels.reduce((total, value) => total + value, 0) : 2;
}

function estimateStorageDays(capacityGb: number | null, megapixels: number) {
  if (!capacityGb) return "Liên hệ để tư vấn";
  const gigabytesPerDay = megapixels <= 2 ? [12, 20]
    : megapixels <= 3 ? [18, 30]
      : megapixels <= 4 ? [24, 40]
        : megapixels <= 5 ? [30, 50]
          : megapixels <= 6 ? [36, 60]
            : [48, 80];
  const shortestDays = Math.max(1, Math.round(capacityGb / gigabytesPerDay[1]));
  const longestDays = Math.max(shortestDays, Math.round(capacityGb / gigabytesPerDay[0]));
  return `~${shortestDays}–${longestDays} ngày`;
}

function cameraGuidance(name: string, specs: Record<string, string[]>) {
  const text = `${name} ${Object.values(specs).flat().join(" ")}`.toLocaleLowerCase("vi");
  const isFourG = /\bsim\s*4g\b|\b4g\b|không dùng wi-fi/.test(text);
  const suitableFor = isFourG
    ? ["Trang trại, công trình hoặc nơi không có Wi-Fi", "Vị trí cần giám sát từ xa qua mạng di động"]
    : /poe/.test(text)
      ? ["Cửa hàng, văn phòng cần kết nối ổn định", "Vị trí đã có hoặc có thể đi dây mạng"]
      : /dual|hai ống kính|2 x/.test(text)
        ? ["Mặt tiền, sân rộng hoặc khu vực nhiều hướng", "Nơi cần giảm điểm mù"]
        : isOutdoorCamera(name, specs)
          ? ["Cổng, sân, hành lang hoặc mặt tiền", "Khu vực cần quan sát ngoài trời"]
          : /xoay|theo dõi|tuần tra/.test(text)
            ? ["Phòng khách, cửa hàng nhỏ", "Gia đình có trẻ nhỏ hoặc người lớn tuổi"]
            : ["Phòng ngủ, phòng khách hoặc cửa hàng nhỏ", "Quầy thu ngân và khu vực trong nhà"];
  const installationNotes = isFourG
    ? ["Cần SIM 4G có gói data", "Cần nguồn điện gần vị trí lắp"]
    : /poe/.test(text)
      ? ["Cần dây mạng PoE hoặc bộ cấp nguồn PoE", "Có thể dùng nguồn 12V khi không dùng PoE"]
      : [
        text.includes("5ghz") ? "Hỗ trợ Wi-Fi 2.4GHz và 5GHz" : "Cần Wi-Fi 2.4GHz tại vị trí lắp",
        text.includes("rj45") ? "Có thể dùng dây mạng RJ45 khi cần" : "Cần nguồn điện gần vị trí lắp",
      ];
  return { suitableFor, installationNotes };
}
