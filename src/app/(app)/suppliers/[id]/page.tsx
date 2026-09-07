import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function SupplierDetailPage({ params }: Props) {
  const { id } = await params;
  redirect(Routes.supplierDetail(id));
}
