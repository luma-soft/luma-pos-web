import { getTranslations } from "next-intl/server";
import Link from "next/link";
import { ClipboardList, FilePlus2, RotateCcw, ShoppingCart } from "lucide-react";
import { Routes } from "@/lib/routes";
import { GroupTabs } from "@/components/group-tabs";
import { Text } from "@/components/ui/text";
import { OrdersTab } from "./tabs/orders";
import { QuotesTab } from "./tabs/quotes";
import { BookingsTab } from "./tabs/bookings";
import { EInvoicesTab } from "./tabs/einvoices";
import { ReturnsTab } from "./tabs/returns";
import { EINVOICE_UI_ENABLED } from "@/lib/features";
import { requireStoreContext } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

const CORE_TABS = [
  { tab: "orders", labelKey: "nav.orders" },
  { tab: "returns", labelKey: "nav.returns" },
  { tab: "quotes", labelKey: "nav.quotes" },
  { tab: "bookings", labelKey: "nav.bookings" },
];

export default async function SalesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const [t, context] = await Promise.all([getTranslations(), requireStoreContext()]);
  const params = await searchParams;
  const einvoiceEnabled = EINVOICE_UI_ENABLED && context.features.einvoice;
  const tabs = einvoiceEnabled ? [...CORE_TABS, { tab: "einvoices", labelKey: "nav.einvoices" }] : CORE_TABS;
  const tab = params.tab === "einvoices" && !einvoiceEnabled ? "orders" : params.tab ?? "orders";

  return (
    <div className="p-4 sm:p-6">
      <div className="sticky top-0 z-20 -mx-4 -mt-4 mb-4 border-b border-border bg-surface sm:-mx-6 sm:-mt-6 lg:mb-5">
        <div className="flex min-h-[68px] items-center px-4 pt-2 sm:px-6 lg:min-h-[52px] lg:pt-2.5">
          <div className="min-w-0">
            <Text as="h1" weight="bold" className="text-xl tracking-[-0.01em] lg:text-[17px]" text={t("nav.groups.sales")} />
            <Text as="p" variant="muted" className="mt-0.5 text-xs font-semibold lg:hidden" text={t("mobile.orders.subtitle")} />
          </div>
        </div>
        <div className="flex items-center gap-3 px-4 pb-1.5 sm:px-6">
          <div className="min-w-0 flex-1">
            <GroupTabs base={Routes.Sales} items={tabs} edgeToEdge={false} />
          </div>
          <SalesPrimaryAction
            tab={tab}
            labels={{
              orders: t("orders.createViaPos"),
              returns: t("returns.create"),
              quotes: t("quotes.createQuote"),
              bookings: t("bookings.createViaPos"),
            }}
          />
        </div>
      </div>

      {tab === "quotes" ? <QuotesTab searchParams={params} />
        : tab === "returns" ? <ReturnsTab searchParams={params} />
        : tab === "bookings" ? <BookingsTab searchParams={params} />
        : tab === "einvoices" && einvoiceEnabled ? <EInvoicesTab />
        : <OrdersTab searchParams={params} />}
    </div>
  );
}

function SalesPrimaryAction({
  tab,
  labels,
}: {
  tab: string;
  labels: Record<"orders" | "returns" | "quotes" | "bookings", string>;
}) {
  const action = tab === "returns"
    ? {
        href: `${Routes.POS}?draft=return_quick`,
        label: labels.returns,
        icon: RotateCcw,
      }
    : tab === "quotes"
      ? {
          href: `${Routes.POS}?draft=quote`,
          label: labels.quotes,
          icon: FilePlus2,
        }
      : tab === "bookings"
        ? {
            href: Routes.POS,
            label: labels.bookings,
            icon: ClipboardList,
          }
        : tab === "orders"
          ? {
              href: Routes.POS,
              label: labels.orders,
              icon: ShoppingCart,
            }
          : null;

  if (!action) return null;
  const Icon = action.icon;

  return (
    <Link
      href={action.href}
      aria-label={action.label}
      className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-full bg-primary-600 px-3.5 text-sm font-semibold text-white transition hover:brightness-110 active:scale-[0.98]"
    >
      <Icon className="size-4" />
      <span className="hidden sm:inline">{action.label}</span>
    </Link>
  );
}
