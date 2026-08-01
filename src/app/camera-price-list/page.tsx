import { getRole } from "@/lib/actions/common";
import { getCameraQuoteFormOptions } from "@/lib/data/camera-quotes";
import { createClient } from "@/lib/supabase/server";
import { CameraPriceListClient } from "../(app)/camera-price-list/camera-price-list-client";

export const dynamic = "force-dynamic";

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
    ["128GB", "512GB"].includes(card.specs["Dung lượng"]?.[0] ?? ""),
  );
  // Hikvision will be added once its package prices are finalised.
  const models = options.cameras
    .filter((camera) => !camera.name.toLocaleLowerCase("vi").includes("hikvision"))
    .map((camera) => ({
      id: camera.id,
      model: camera.name,
      description: camera.description ?? "Thiết bị camera chính hãng, phù hợp nhu cầu giám sát.",
      imageUrl: camera.imageUrl,
      specs: camera.specs,
      installationLocation: cameraInstallationLocation(camera.name, camera.specs),
      variants: memoryOptions.map((card) => ({
        id: `${camera.id}:${card.id}`,
        cameraId: camera.id,
        cardId: card.id,
        cameraPrice: camera.retailPrice,
        cardPrice: card.retailPrice,
        installationPrice,
        materialPrice,
        price: camera.retailPrice + card.retailPrice + basePrice,
      })),
    }));
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
