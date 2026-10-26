import { redirect } from "next/navigation";

export default async function StocktakesRedirect({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const sp = await searchParams;
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(sp)) if (typeof v === "string") usp.set(k, v);
  const search = usp.get("q");
  if (search) {
    usp.set("stocktakeQ", search);
    usp.delete("q");
  }
  usp.set("tab", "stock");
  redirect(`/inventory?${usp.toString()}`);
}
