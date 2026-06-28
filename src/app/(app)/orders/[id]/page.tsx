import Link from "next/link";
import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { einvoices } from "@/db/schema";
import { Routes } from "@/lib/routes";
import { getOrder } from "@/lib/data/orders";
import { Text } from "@/components/ui/text";
import { OrderDetailPanel } from "./order-detail-panel";

export default async function OrderDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTranslations();
  const order = await getOrder(id).catch(() => null);
  if (!order) notFound();
  const [einvoice] = await db.select().from(einvoices).where(eq(einvoices.orderId, id)).limit(1);

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-5 flex min-h-[58px] flex-wrap items-center gap-3 border-b border-border bg-surface px-4 py-2.5 sm:-mx-6 sm:-mt-6 sm:px-6">
        <Link href={Routes.Orders} className="rounded-lg p-2 hover:bg-slate-100 dark:hover:bg-slate-800" aria-label={t("common.back")}>
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <Text as="h1" weight="bold" className="text-[17px]" text={order.code} />
      </div>
      <div className="max-w-6xl">
        <OrderDetailPanel order={order} einvoice={einvoice ?? null} />
      </div>
    </div>
  );
}
