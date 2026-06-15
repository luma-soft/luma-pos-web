import { redirect } from "next/navigation";

export default async function PricingRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") usp.set(k, v);
  usp.set("tab", "pricing");
  redirect(`/inventory?${usp.toString()}`);
}
