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
  const memoryOptions = options.cards.slice(0, 2);
  // Hikvision will be added once its package prices are finalised.
  const models = options.cameras
    .filter((camera) => !camera.name.toLocaleLowerCase("vi").includes("hikvision"))
    .map((camera) => ({
      id: camera.id,
      model: camera.name,
      description: camera.description ?? "Thiết bị camera chính hãng, phù hợp nhu cầu giám sát.",
      imageUrl: camera.imageUrl,
      specs: camera.specs,
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
    memoryLabels={memoryOptions.map((_, index) => `Thẻ nhớ camera ${index === 0 ? "32GB" : "64GB"}`)}
    canEdit={canEdit}
  />;
}
