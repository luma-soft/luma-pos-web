import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";

export default function ShopeeInboxRedirectPage() {
  redirect(ONLINE_SALES_ENABLED ? `${Routes.OnlineSales}?tab=inbox&channel=shopee` : Routes.Dashboard);
}
