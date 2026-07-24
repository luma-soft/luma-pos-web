import { notFound } from "next/navigation";
import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";
import { getOrder } from "@/lib/data/orders";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await getOrder(id).catch(() => null);
  if (!order) notFound();
  redirect(Routes.salesOrder(order.id, order.status));
}
