import { notFound, redirect } from "next/navigation";
import { resolveLegacyCurrentPublicStore } from "@/lib/tenancy/public-store";

export default async function LegacyHikvisionCameraQuotePage() {
  const store = await resolveLegacyCurrentPublicStore("camera_quote_builder");
  if (!store) notFound();
  redirect(`/s/${store.slug}/camera-quote/hikvision`);
}
