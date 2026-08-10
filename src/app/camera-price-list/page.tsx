import { notFound, redirect } from "next/navigation";
import { resolveLegacyCurrentPublicStore } from "@/lib/tenancy/public-store";

export default async function LegacyCameraPriceListPage() {
  const store = await resolveLegacyCurrentPublicStore("camera_price_list");
  if (!store) notFound();
  redirect(`/s/${store.slug}/camera-quote`);
}
