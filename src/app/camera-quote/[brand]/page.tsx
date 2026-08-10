import { notFound, redirect } from "next/navigation";
import { resolveLegacyCurrentPublicStore } from "@/lib/tenancy/public-store";

export default async function LegacyBrandCameraQuotePage({ params }: { params: Promise<{ brand: string }> }) {
  const [{ brand }, store] = await Promise.all([
    params,
    resolveLegacyCurrentPublicStore("camera_quote_builder"),
  ]);
  if (!store || !["ezviz", "imou"].includes(brand)) notFound();
  redirect(`/s/${store.slug}/camera-quote/${brand}`);
}
