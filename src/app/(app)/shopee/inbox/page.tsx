import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";

export default function ShopeeInboxRedirectPage() {
  redirect(`${Routes.OnlineSales}?tab=inbox&channel=shopee`);
}
