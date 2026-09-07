import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function EditProductPage({ params, searchParams }: Props) {
  const { id } = await params;
  const sp = await searchParams;
  const target = new URLSearchParams({
    tab: "products",
    productModal: "edit",
    productId: id,
  });

  if (sp.groupEdit === "1") target.set("productModal", "groupEdit");
  if (typeof sp.source === "string") target.set("source", sp.source);

  redirect(`${Routes.Inventory}?${target.toString()}`);
}
