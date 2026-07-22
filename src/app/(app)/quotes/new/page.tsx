import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function NewCameraQuotePage() {
  redirect("/pos?cameraQuote=1");
}
