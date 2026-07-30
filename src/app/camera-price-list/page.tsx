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
  const basePrice = (options.installations[0]?.retailPrice ?? 0) + (options.materials[0]?.retailPrice ?? 0);
  const packages = options.cameras.flatMap((camera) => options.cards.map((card) => ({
    id: `${camera.id}:${card.id}`, cameraId: camera.id, cardId: card.id,
    model: camera.name, description: camera.description ?? "Thiết bị camera chính hãng, phù hợp nhu cầu giám sát.", memory: card.name,
    price: camera.retailPrice + card.retailPrice + basePrice,
  })));
  return <CameraPriceListClient packages={packages} canEdit={canEdit} />;
}
