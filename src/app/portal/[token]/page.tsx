import { productDisplayName } from "@/lib/products/variant-presentation";
import { notFound } from "next/navigation";
import { getPortalCatalog } from "@/lib/data/portal";
import { PortalClient } from "./portal-client";

export const dynamic = "force-dynamic";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();

  const catalog = await getPortalCatalog(token);
  if (!catalog) notFound();
  const { customer, productRows } = catalog;

  const priceFor = (p: typeof productRows[number]) => {
    const pick =
      customer.type === "wholesale" ? p.wholesalePrice :
      customer.type === "contractor" ? p.contractorPrice :
      customer.type === "agent" ? p.agentPrice : null;
    return Number(pick ?? p.retailPrice);
  };

  return (
    <PortalClient
      token={token}
      customerName={customer.name}
      customerType={customer.type}
      products={productRows.map((p) => ({
        id: p.id, name: productDisplayName(p), sku: p.sku, baseUnit: p.baseUnit, price: priceFor(p),
      }))}
    />
  );
}
