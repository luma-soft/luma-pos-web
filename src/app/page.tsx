import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Routes } from "@/lib/routes";

export default async function Home() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const reviewPath = `${Routes.OnlineSales}?tab=overview&channel=shopee`;
  redirect(user?.email?.toLowerCase() === "review@lumapos.shop" ? reviewPath : user ? Routes.Dashboard : Routes.Login);
}
