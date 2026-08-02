import { redirect } from "next/navigation";
import { EINVOICE_UI_ENABLED } from "@/lib/features";

export default async function EInvoicesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  if (!EINVOICE_UI_ENABLED) redirect("/sales");
  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") usp.set(k, v);
  usp.set("tab", "einvoices");
  redirect(`/sales?${usp.toString()}`);
}
