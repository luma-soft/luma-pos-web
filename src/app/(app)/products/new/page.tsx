import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewProductPage({ searchParams }: Props) {
  const sp = await searchParams;
  const target = new URLSearchParams({
    tab: "products",
    productModal: "create",
  });
  const copyFrom = typeof sp.copyFrom === "string" ? sp.copyFrom : undefined;
  const sameTypeAs = typeof sp.sameTypeAs === "string" ? sp.sameTypeAs : undefined;

  if (copyFrom) {
    target.set("productModal", "copy");
    target.set("copyFrom", copyFrom);
    if (sp.copyGroup === "1") target.set("copyGroup", "1");
  } else if (sameTypeAs) {
    target.set("productModal", "sameType");
    target.set("sameTypeAs", sameTypeAs);
  }
  if (typeof sp.productKind === "string") target.set("productKind", sp.productKind);
  if (typeof sp.source === "string") target.set("source", sp.source);

  redirect(`${Routes.Inventory}?${target.toString()}`);
}
