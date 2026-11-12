import { redirect } from "next/navigation";
import { getAuthenticatedUser } from "@/lib/auth/store-context";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";

export default async function Home() {
  const user = await getAuthenticatedUser();
  const reviewPath = `${Routes.OnlineSales}?tab=overview&channel=shopee`;
  redirect(ONLINE_SALES_ENABLED && user?.email?.toLowerCase() === "review@lumapos.shop" ? reviewPath : user ? Routes.Dashboard : Routes.Login);
}
