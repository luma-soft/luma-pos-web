import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(Routes.customerDetail(id));
}
