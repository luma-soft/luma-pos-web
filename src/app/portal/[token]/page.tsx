import { productDisplayName } from "@/lib/products/variant-presentation";
import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, products } from "@/db/schema";
import { PortalClient } from "./portal-client";

export const dynamic = "force-dynamic";

export default async function PortalPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token || token.length < 20) notFound();

  const [customer] = await db
    .select({ id: customers.id, name: customers.name, type: customers.type, currentDebt: customers.currentDebt, debtLimit: customers.debtLimit })
    .from(customers)
    .where(eq(customers.portalToken, token))
    .limit(1);
  if (!customer) notFound();

  const productRows = await db
    .select({
      id: products.id,
      name: products.name,
      variantName: products.variantName,
      specs: products.specs,
      sku: products.sku,
      baseUnit: products.baseUnit,
      retailPrice: products.retailPrice,
      wholesalePrice: products.wholesalePrice,
      contractorPrice: products.contractorPrice,
      agentPrice: products.agentPrice,
    })
    .from(products)
    .where(eq(products.isActive, true))
    .orderBy(asc(products.name))
    .limit(500);

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
