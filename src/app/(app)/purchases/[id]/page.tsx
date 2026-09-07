import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";

export default async function PurchaseDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(Routes.purchaseDetail(id));
}
