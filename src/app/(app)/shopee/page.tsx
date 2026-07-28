import { redirect } from "next/navigation";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";

export default function ShopeeRedirectPage() {
  redirect(ONLINE_SALES_ENABLED ? `${Routes.OnlineSales}?channel=shopee` : Routes.Dashboard);
}
