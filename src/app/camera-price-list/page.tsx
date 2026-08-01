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
      const compatibleCards = memoryOptions.filter((card) => {
        const capacityGb = memoryCardCapacityGb(card.specs);
        return maxStorageGb === null || capacityGb === null || capacityGb <= maxStorageGb;
      });
      return {
        id: camera.id,
        model: camera.name,
        description: camera.description ?? "Thiết bị camera chính hãng, phù hợp nhu cầu giám sát.",
        imageUrl: camera.imageUrl,
        specs: camera.specs,
        installationLocation: cameraInstallationLocation(camera.name, camera.specs),
        variants: compatibleCards.map((card) => ({
          id: `${camera.id}:${card.id}`,
          cameraId: camera.id,
          cardId: card.id,
          cameraPrice: camera.retailPrice,
          cardPrice: card.retailPrice,
          installationPrice,
          materialPrice,
          price: camera.retailPrice + card.retailPrice + basePrice,
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
