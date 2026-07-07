import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";

export default function ShopeeRedirectPage() {
  redirect(`${Routes.OnlineSales}?channel=shopee`);
}
