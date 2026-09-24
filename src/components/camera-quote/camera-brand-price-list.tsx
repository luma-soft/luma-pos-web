import { getRole } from "@/lib/actions/common";
import { getCameraQuoteFormOptions, type CameraQuoteProductOption } from "@/lib/data/camera-quotes";
import { getStoreSettings } from "@/lib/data/settings";
import { createClient } from "@/lib/supabase/server";
import { CameraPriceListClient } from "@/app/(app)/camera-price-list/camera-price-list-client";
import { estimateStorageDays } from "@/lib/camera-storage-estimate";
import {
  cameraQuoteInstallationProfile,
  cameraQuotePrice,
  cameraQuoteProfileProducts,
  resolveCameraQuoteDefaults,
} from "@/lib/camera-quote-settings";

type CameraBrand = "EZVIZ" | "IMOU";

export async function CameraBrandPriceList({ brand, storeId }: { brand: CameraBrand; storeId: string }) {
  const [options, store, supabase] = await Promise.all([
    getCameraQuoteFormOptions(storeId),
    getStoreSettings(storeId),
    createClient(),
  ]);
  const quoteSettings = store.prefs.cameraQuote;
  const quoteDefaults = resolveCameraQuoteDefaults(options, quoteSettings);
  const { data: { user } } = await supabase.auth.getUser();
  let canEdit = false;
  if (user) {
    try {
      const role = await getRole(user.id);
      canEdit = role === "owner" || role === "manager";
    } catch {
      // Guests can view the public price list.
    }
  }

  // Older/imported card records may have prices but no structured specs. Keep
  // those cards in the quote by deriving capacity from their name/SKU.
  const memoryOptions = quoteDefaults.cards.filter((card) => {
    const capacity = memoryCardLabel(card);
    return ["32GB", "64GB", "128GB", "512GB"].includes(capacity ?? "");
  });
  const models = options.cameras
    .filter((camera) => camera.brand === brand)
    .map((camera) => {
      const maxStorageGb = cameraMaxStorageGb(camera.specs);
      const megapixels = cameraMegapixels(camera.specs);
      const profile = cameraQuoteInstallationProfile(camera.name, camera.specs);
      const profileProducts = cameraQuoteProfileProducts(quoteDefaults, profile);
      const cameraPrice = cameraQuotePrice(camera.id, camera.retailPrice, quoteSettings);
      const installationPrice = profileProducts.installation
        ? cameraQuotePrice(profileProducts.installation.id, profileProducts.installation.retailPrice, quoteSettings)
        : 0;
      const materialPrice = profileProducts.material
        ? cameraQuotePrice(profileProducts.material.id, profileProducts.material.retailPrice, quoteSettings)
        : 0;
      const installationLocation: "Trong nhà" | "Ngoài trời" = profile === "indoor" ? "Trong nhà" : "Ngoài trời";
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
        installationLocation,
        suitableFor: guidance.suitableFor,
        variants: compatibleCards.map((card) => ({
          id: `${camera.id}:${card.id}`,
          cameraId: camera.id,
          cardId: card.id,
          cameraPrice,
          cardPrice: cameraQuotePrice(card.id, card.retailPrice, quoteSettings),
          installationPrice,
          materialPrice,
          price: cameraPrice + cameraQuotePrice(card.id, card.retailPrice, quoteSettings) + installationPrice + materialPrice,
          storageEstimate: estimateStorageDays(memoryCardCapacityGb(card.specs), megapixels),
        })),
      };
    });

  return (
    <CameraPriceListClient
      models={models}
      memoryLabels={memoryOptions.map((card) => `Thẻ nhớ ${memoryCardLabel(card) ?? card.name}`)}
      canEdit={canEdit}
      brandName={brand}
    />
  );
}

function isOutdoorCamera(name: string, specs: Record<string, string[]>) {
  return cameraQuoteInstallationProfile(name, specs) !== "indoor";
}

function specValue(specs: Record<string, string[]>, label: string) {
  const expected = label.trim().toLocaleLowerCase("vi");
  return Object.entries(specs).find(([key]) => key.trim().toLocaleLowerCase("vi") === expected)?.[1]?.join(" ") ?? "";
}

function memoryCardCapacityGb(specs: Record<string, string[]>) {
  return storageCapacityGb(specValue(specs, "Dung lượng"));
}

function memoryCardLabel(card: Pick<CameraQuoteProductOption, "name" | "specs">) {
  return specValue(card.specs, "Dung lượng").match(/\b(32|64|128|512)\s*GB\b/i)?.[0]?.replace(/\s+/g, "").toUpperCase()
    ?? card.name.match(/\b(32|64|128|512)\s*GB\b/i)?.[0]?.replace(/\s+/g, "").toUpperCase();
}

function cameraMaxStorageGb(specs: Record<string, string[]>) {
  return storageCapacityGb(specValue(specs, "Nguồn / lưu trữ"));
}

function storageCapacityGb(value: string) {
  const capacities = (value.match(/\d+\s*GB/gi) ?? []).map((capacity) => Number.parseInt(capacity, 10));
  return capacities.length ? Math.max(...capacities) : null;
}

function cameraMegapixels(specs: Record<string, string[]>) {
  const megapixels = (specValue(specs, "Độ phân giải").match(/\d+\s*MP/gi) ?? [])
    .map((value) => Number.parseInt(value, 10));
  return megapixels.length ? megapixels.reduce((total, value) => total + value, 0) : 2;
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
  return { suitableFor };
}
