import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewCameraQuotePage() {
  redirect("/camera-price-list");
}
