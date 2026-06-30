import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { LayoutDashboard } from "lucide-react";
import { getPosData } from "@/lib/data/pos";
import { getStoreSettings } from "@/lib/data/settings";
import { getOrder } from "@/lib/data/orders";
import { getPrintTemplate } from "@/lib/print/template";
import { Routes } from "@/lib/routes";
import { formatDate } from "@/lib/utils";
import { PosClient, type PosSourceInvoice } from "./pos-client";

export const dynamic = "force-dynamic";

type PosSearchParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function csvUuids(value: string | string[] | undefined) {
  const raw = one(value);
  if (!raw) return [];
  return raw.split(",").map((item) => item.trim()).filter((item) => UUID_RE.test(item));
}

async function sourceInvoiceFromParams(params: PosSearchParams): Promise<PosSourceInvoice | null> {
  const mode = one(params.sourceMode);
  const orderId = one(params.sourceOrderId);
  if ((mode !== "edit" && mode !== "copy") || !orderId || !UUID_RE.test(orderId)) return null;
  const order = await getOrder(orderId);
  if (!order) return null;
  return {
    mode,
    id: order.id,
    code: order.code,
    saleTime: formatDate(order.createdAt),
    customerId: order.customerId ?? "",
    projectId: order.projectId ?? "",
    projectName: order.projectName ?? "",
    note: order.note ?? "",
    discount: Number(order.discount),
    shippingFee: Number(order.shippingFee),
    tax: Number(order.tax ?? 0),
    subtotal: Number(order.subtotal),
    items: order.items.map((item) => ({
      productId: item.productId,
      unitName: item.unitName,
      quantity: Number(item.quantity),
      unitPrice: Number(item.unitPrice),
      lineDiscount: Number(item.discount ?? 0),
      note: item.note ?? "",
    })),
  };
}

export default async function POSPage({ searchParams }: { searchParams: Promise<PosSearchParams> }) {
  const params = await searchParams;
  const sourceInvoice = await sourceInvoiceFromParams(params);
  const aiProductIds = csvUuids(params.aiProducts);
  const includeProductIds = [
    ...(sourceInvoice?.items?.map((item) => item.productId) ?? []),
    ...aiProductIds,
  ];
  const [data, settings, t, orderPrintTemplate, quotePrintTemplate, bookingPrintTemplate] = await Promise.all([
    getPosData({ includeProductIds }),
    getStoreSettings(),
    getTranslations(),
    getPrintTemplate("order"),
    getPrintTemplate("quote"),
    getPrintTemplate("booking"),
  ]);
  return (
    <div className="h-full flex flex-col">
      {/* top bar gọn — thay cho sidebar admin (giống KiotViet) */}
      <header className="shrink-0 h-[58px] px-4 sm:px-6 flex items-center justify-between bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800">
        <Link
          href={Routes.Home}
          className="flex items-center gap-2.5 min-w-0 rounded-lg pr-2 transition hover:text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          aria-label={t("common.appName")}
        >
          <div className="w-7 h-7 rounded-lg grid place-items-center text-white font-extrabold text-sm bg-gradient-to-br from-primary-600 to-primary-400">S</div>
          <span className="font-bold text-sm truncate">{t("common.appName")}</span>
          <span className="text-xs text-slate-400 hidden sm:inline">· {t("nav.pos")}</span>
        </Link>
        <Link
          href={Routes.Dashboard}
          className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-primary-600 px-3 py-1.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800"
        >
          <LayoutDashboard className="w-4 h-4" />
          <span className="hidden sm:inline">{t("nav.dashboard")}</span>
        </Link>
      </header>
      <div className="flex-1 min-h-0">
        <PosClient
          data={data}
          printTemplate={orderPrintTemplate}
          quotePrintTemplate={quotePrintTemplate}
          bookingPrintTemplate={bookingPrintTemplate}
          initialSourceInvoice={sourceInvoice}
          posPrefs={settings.prefs.pos}
        />
      </div>
    </div>
  );
}
