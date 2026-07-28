import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const reviewPath = `${Routes.OnlineSales}?tab=overview&channel=shopee`;
  redirect(ONLINE_SALES_ENABLED && user?.email?.toLowerCase() === "review@lumapos.shop" ? reviewPath : user ? Routes.Dashboard : Routes.Login);
}
