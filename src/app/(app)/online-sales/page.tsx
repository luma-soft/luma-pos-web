import { catalogTextByFlag, legacyTextByFlag } from "@/lib/i18n/catalog-text";
import { Checkbox } from "@/components/ui/checkbox";
import Link from "next/link";
import { PartnerDetailLink } from "@/components/partner-detail-link";
import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { ExternalLink, Inbox, Layers3, RefreshCw, Send, ShoppingBag, Store } from "lucide-react";
import { getShopeeDashboard, getShopeeInbox } from "@/lib/data/marketplace";
import { sendMarketplaceMessage, updateMarketplaceShopSyncPolicy } from "@/lib/actions/marketplace";
import { getProduct } from "@/lib/data/products";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { OrderDetailLink } from "@/components/order-detail-link";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { disconnectShopeeShop } from "@/lib/actions/marketplace";
import { ShopeeListingModal } from "../inventory/tabs/shopee-listing-modal";
import { Select } from "@/components/ui/select";
import { NumberInput } from "@/components/ui/number-input";
import { OnlineSalesListingButton } from "./online-sales-product-search";
import { requireStoreContext } from "@/lib/auth/store-context";
import { requirePageFeature } from "@/lib/tenancy/page-feature";

type SP = Record<string, string | undefined>;
type OnlineSalesTab = "overview" | "channels" | "listings" | "orders" | "inbox" | "sync";

const TABS: OnlineSalesTab[] = ["overview", "channels", "listings", "orders", "inbox", "sync"];
const PROVIDERS = [
  { id: "shopee", name: "Shopee", ready: true },
  { id: "tiktok_shop", name: "TikTok Shop", ready: false },
  { id: "lazada", name: "Lazada", ready: false },
  { id: "tiki", name: "Tiki", ready: false },
] as const;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default async function OnlineSalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  if (!ONLINE_SALES_ENABLED) redirect(Routes.Dashboard);
  await requirePageFeature("online_sales");

  const context = await requireStoreContext();
  const locale = await getLocale();
  const L = locale === "vi";
  const params = await searchParams;
  const tab = TABS.includes(params.tab as OnlineSalesTab) ? params.tab as OnlineSalesTab : "overview";
  const [data, inbox] = await Promise.all([getShopeeDashboard(context.storeId), getShopeeInbox(context.storeId)]);
  const shop = data.shop;
  const connectedChannels = shop && ["connected", "authorized"].includes(shop.status) ? 1 : 0;
  const onlineOrderCount = data.orderMappings.length;
  const listingProduct = params.onlineProductId && UUID_RE.test(params.onlineProductId) ? await getProduct(context.storeId, params.onlineProductId) : null;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-primary-600">{legacyTextByFlag(L, "870091dab44d")}</div>
          <h1 className="text-2xl font-extrabold tracking-tight">{legacyTextByFlag(L, "c15ba4ec48b3")}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {legacyTextByFlag(L, "ab7c80c71f6e")}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={tabHref("inbox")} className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-surface-2">
            <Inbox className="h-4 w-4" /> {legacyTextByFlag(L, "8dd0da0692b2")}
          </Link>
          <Link href="/settings?tab=shopee" className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm font-semibold hover:bg-surface-2">
            <Store className="h-4 w-4" /> {legacyTextByFlag(L, "61acf89ee6a8")}
          </Link>
          <Link href={tabHref("channels")} className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:brightness-110">
            <ShoppingBag className="h-4 w-4" /> {legacyTextByFlag(L, "80e925617bfc")}
          </Link>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((item) => (
          <Link
            key={item}
            href={tabHref(item)}
            className={cn(
              "inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center border-b-2 px-3 py-2 text-sm font-semibold lg:min-h-0 lg:min-w-0",
              tab === item ? "border-primary-600 text-primary-600" : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200",
            )}
          >
            {tabLabel(item, L)}
          </Link>
        ))}
      </div>

      {params.error && (
        <div className="rounded-card border border-warn/20 bg-warn-soft px-4 py-3 text-sm font-semibold text-warn">
          {onlineSalesError(params.error, L)}
        </div>
      )}

      {(tab === "overview" || tab === "channels") && (
        <>
          <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Metric title={legacyTextByFlag(L, "d763b07b7e3e")} value={formatNumber(connectedChannels)} muted={connectedChannels === 0} />
            <Metric title={legacyTextByFlag(L, "78b5ecaca7d4")} value={formatNumber(data.metrics.listings)} />
            <Metric title={legacyTextByFlag(L, "3bf1fff1f721")} value={formatNumber(onlineOrderCount)} />
            <Metric title={legacyTextByFlag(L, "a0a2016e2487")} value={`${formatNumber(data.metrics.failedJobs)} / ${formatNumber(data.metrics.pendingJobs)}`} tone={data.metrics.failedJobs > 0 ? "warn" : "normal"} />
          </section>

          <section className="rounded-card border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
              <div>
                <h2 className="text-sm font-extrabold">{legacyTextByFlag(L, "58d47eb1b848")}</h2>
                <p className="text-xs text-slate-500">{legacyTextByFlag(L, "33bba144ab08")}</p>
              </div>
              <Link href={tabHref("channels")} className="inline-flex h-11 items-center gap-2 rounded-lg border border-border px-3 text-xs font-bold hover:bg-surface-2">
                <Layers3 className="h-3.5 w-3.5" /> {legacyTextByFlag(L, "52179dbb8ecb")}
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
              {PROVIDERS.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} shop={provider.id === "shopee" ? shop : null} L={L} />
              ))}
            </div>
          </section>

          {tab === "channels" && data.shops.length > 0 && (
            <section className="rounded-card border border-border bg-surface">
              <div className="border-b border-border-soft px-4 py-3">
                <h2 className="text-sm font-extrabold">{legacyTextByFlag(L, "718a727e7512")}</h2>
                <p className="text-xs text-slate-500">{legacyTextByFlag(L, "37c377c2e71c")}</p>
              </div>
              <div className="divide-y divide-border-soft">
                {data.shops.map((shopRow) => (
                  <ShopPolicyForm key={shopRow.id} shop={shopRow} warehouses={data.warehouses} L={L} />
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {tab === "listings" || tab === "overview" ? <ListingsSection data={data} L={L} tab={tab} /> : null}
      {tab === "orders" && <OnlineOrdersSection rows={data.orderMappings} L={L} />}
      {tab === "inbox" && <InboxSection threads={inbox.threads} L={L} />}
      {tab === "sync" || tab === "overview" ? <SyncSection jobs={data.jobs} L={L} /> : null}
      {params.onlineListing === "1" && (
        <ShopeeListingModal
          key={listingProduct?.id ?? "new-online-listing"}
          product={listingProduct}
          closeHref={onlineSalesModalHref(params, {})}
        />
      )}
    </div>
  );
}

function ShopPolicyForm({
  shop,
  L,
}: {
  shop: NonNullable<Awaited<ReturnType<typeof getShopeeDashboard>>["shops"]>[number];
  warehouses: Awaited<ReturnType<typeof getShopeeDashboard>>["warehouses"];
  L: boolean;
}) {
  const policy = shopSyncPolicy(shop.metadata);
  return (
    <form action={async (formData: FormData) => {
      "use server";
      await updateMarketplaceShopSyncPolicy({
        shopId: shop.id,
        warehouseId: String(formData.get("warehouseId") ?? ""),
        syncStock: formData.get("syncStock") === "on",
        syncPrice: formData.get("syncPrice") === "on",
        importOrders: formData.get("importOrders") === "on",
        syncMessages: formData.get("syncMessages") === "on",
        autoCreateCustomer: formData.get("autoCreateCustomer") === "on",
        stockBuffer: Number(formData.get("stockBuffer") ?? 0),
        minStockThreshold: Number(formData.get("minStockThreshold") ?? 0),
        outOfStockBehavior: String(formData.get("outOfStockBehavior") ?? "keep_visible") as "keep_visible" | "unlist" | "set_zero",
      });
    }} className="grid grid-cols-1 gap-3 px-4 py-4 xl:grid-cols-[220px_1fr_auto]">
      <div className="min-w-0">
        <div className="font-semibold">{shop.shopName || shop.shopId}</div>
        <div className="mt-1 text-xs text-slate-500">Shopee · {shop.region} · {shop.status}</div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        <input type="hidden" name="warehouseId" value={policy.warehouseId ?? ""} />
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{legacyTextByFlag(L, "3d4ce4f326f6")}</span>
          <NumberInput name="stockBuffer" decimals={4} min={0} defaultValue={policy.stockBuffer} className="bg-canvas" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{legacyTextByFlag(L, "1176d368d1be")}</span>
          <NumberInput name="minStockThreshold" decimals={4} min={0} defaultValue={policy.minStockThreshold} className="bg-canvas" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{legacyTextByFlag(L, "25b2b4f1a6d8")}</span>
          <Select
            name="outOfStockBehavior"
            defaultValue={policy.outOfStockBehavior}
            options={[
              { value: "keep_visible", label: legacyTextByFlag(L, "6915a1c6d014") },
              { value: "unlist", label: legacyTextByFlag(L, "dea0d40fa780") },
              { value: "set_zero", label: legacyTextByFlag(L, "736a05178c80") },
            ]}
            className="w-full bg-canvas"
          />
        </label>
        {[
          ["syncStock", legacyTextByFlag(L, "e96763ba4eca"), policy.syncStock],
          ["syncPrice", legacyTextByFlag(L, "2f3782706ef0"), policy.syncPrice],
          ["importOrders", legacyTextByFlag(L, "5ec1f0dc6f85"), policy.importOrders],
          ["syncMessages", legacyTextByFlag(L, "2ba98abb03f2"), policy.syncMessages],
          ["autoCreateCustomer", legacyTextByFlag(L, "932d4723739a"), policy.autoCreateCustomer],
        ].map(([name, label, checked]) => (
          <label key={String(name)} className="flex min-h-11 min-w-11 items-center justify-between gap-3 rounded-lg border border-border-soft bg-canvas px-3 py-2 text-sm font-semibold lg:min-h-0 lg:min-w-0">
            <span>{label}</span>
            <Checkbox name={String(name)} defaultChecked={Boolean(checked)} className="h-4 w-4" />
          </label>
        ))}
      </div>
      <div className="flex items-start justify-end">
        <button className="h-11 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:brightness-110">{legacyTextByFlag(L, "2d7e281f1bcd")}</button>
      </div>
    </form>
  );
}

function shopSyncPolicy(metadata: unknown) {
  const meta = metadata && typeof metadata === "object" && !Array.isArray(metadata)
    ? metadata as { syncPolicy?: Record<string, unknown> }
    : {};
  const policy = meta.syncPolicy ?? {};
  return {
    warehouseId: typeof policy.warehouseId === "string" ? policy.warehouseId : "",
    syncStock: typeof policy.syncStock === "boolean" ? policy.syncStock : true,
    syncPrice: typeof policy.syncPrice === "boolean" ? policy.syncPrice : true,
    importOrders: typeof policy.importOrders === "boolean" ? policy.importOrders : true,
    syncMessages: typeof policy.syncMessages === "boolean" ? policy.syncMessages : false,
    autoCreateCustomer: typeof policy.autoCreateCustomer === "boolean" ? policy.autoCreateCustomer : true,
    stockBuffer: Number(policy.stockBuffer ?? 0),
    minStockThreshold: Number(policy.minStockThreshold ?? 0),
    outOfStockBehavior: ["keep_visible", "unlist", "set_zero"].includes(String(policy.outOfStockBehavior)) ? String(policy.outOfStockBehavior) : "keep_visible",
  };
}

function tabHref(tab: OnlineSalesTab) {
  return `${Routes.OnlineSales}?tab=${tab}`;
}

function onlineSalesModalHref(params: SP, patch: Record<string, string>) {
  const sp = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (!value || key === "onlineListing" || key === "onlineProductId" || key === "shopeeProductId") continue;
    sp.set(key, value);
  }
  for (const [key, value] of Object.entries(patch)) sp.set(key, value);
  const query = sp.toString();
  return query ? `${Routes.OnlineSales}?${query}` : Routes.OnlineSales;
}

function tabLabel(tab: OnlineSalesTab, L: boolean) {
  const keys: Record<OnlineSalesTab, string> = {
    overview: "overview",
    channels: "channels",
    listings: "listings",
    orders: "orders",
    inbox: "inbox",
    sync: "sync",
  };
  return catalogTextByFlag(L, `onlineSales.tabs.${keys[tab]}`);
}

function onlineSalesError(error: string, L: boolean) {
  if (error === "missing_shopee_partner_credentials") {
    return legacyTextByFlag(L, "8c26f340ef71");
  }
  if (error === "invalid_shopee_partner_id") {
    return legacyTextByFlag(L, "3d373b0060ed");
  }
  if (error === "marketplace_migration_required") {
    return legacyTextByFlag(L, "6d3f3decb1ba");
  }
  return legacyTextByFlag(L, "c657cbb5b515");
}

function ProviderCard({ provider, shop, L }: { provider: (typeof PROVIDERS)[number]; shop: Awaited<ReturnType<typeof getShopeeDashboard>>["shop"]; L: boolean }) {
  const connected = Boolean(shop && ["connected", "authorized"].includes(shop.status));
  return (
    <div className="rounded-card border border-border-soft bg-canvas px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-extrabold">{provider.name}</div>
          <div className="mt-1 text-xs text-slate-500">
            {provider.ready
              ? connected ? `${shop?.shopName || shop?.shopId} · ${shop?.status}` : (legacyTextByFlag(L, "85b59c66b347"))
              : (legacyTextByFlag(L, "7d8362626964"))}
          </div>
        </div>
        <Badge value={provider.ready ? (connected ? "connected" : "available") : "soon"} />
      </div>
      <div className="mt-4">
        {provider.id === "shopee" ? (
          connected && shop ? (
            <form action={async () => {
              "use server";
              await disconnectShopeeShop(shop.id);
            }}>
              <button className="h-11 w-full rounded-lg border border-border px-3 text-xs font-bold hover:bg-surface-2">{legacyTextByFlag(L, "78dd8a5562e5")}</button>
            </form>
          ) : (
            <Link href="/api/shopee/connect" className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-primary-600 px-3 text-xs font-bold text-white hover:brightness-110">
              <ExternalLink className="h-3.5 w-3.5" /> {legacyTextByFlag(L, "3ff549165767")}
            </Link>
          )
        ) : (
          <button disabled className="h-11 w-full rounded-lg border border-border px-3 text-xs font-bold text-slate-400">{legacyTextByFlag(L, "f4895efd37b3")}</button>
        )}
      </div>
    </div>
  );
}

function ListingsSection({ data, L, tab }: { data: Awaited<ReturnType<typeof getShopeeDashboard>>; L: boolean; tab: OnlineSalesTab }) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="flex flex-col gap-3 border-b border-border-soft px-4 py-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-sm font-extrabold">{legacyTextByFlag(L, "6ae9f768a649")}</h2>
          <p className="text-xs text-slate-500">{legacyTextByFlag(L, "5bc1c75fa89d")}</p>
        </div>
        <OnlineSalesListingButton L={L} tab={tab === "overview" ? "overview" : "listings"} />
      </div>
      {data.mappings.length > 0 && (
        <div className="divide-y divide-border-soft lg:hidden" data-mobile-audit="online-listings">
          {data.mappings.map((row) => (
            <article key={row.id} className="space-y-3 p-3">
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={Routes.product(row.productId)}
                  className="inline-flex min-h-11 flex-1 items-center break-words font-semibold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 min-w-11"
                >
                  {row.productName}
                </Link>
                <Badge value={row.status} />
              </div>
              <div className="text-xs text-slate-500">{row.sku}</div>
              <dl className="grid grid-cols-2 gap-2 text-xs">
                <div><dt className="text-slate-500">{legacyTextByFlag(L, "d59890269eb3")}</dt><dd className="mt-0.5"><Badge value="Shopee" /></dd></div>
                <div><dt className="text-slate-500">{legacyTextByFlag(L, "fcf865a68ac5")}</dt><dd className="mt-0.5 text-right font-semibold tabular-nums">{row.price ? formatCurrency(Number(row.price)) : "—"}</dd></div>
                <div><dt className="text-slate-500">{legacyTextByFlag(L, "75dc5449a256")}</dt><dd className="mt-0.5 tabular-nums">{row.stock ? formatNumber(Number(row.stock)) : "—"}</dd></div>
                <div><dt className="text-slate-500">{legacyTextByFlag(L, "13053e86f1ba")}</dt><dd className="mt-0.5 break-all font-mono">{row.externalItemId ?? "—"}</dd></div>
                <div className="col-span-2"><dt className="text-slate-500">{legacyTextByFlag(L, "1117ac6b3218")}</dt><dd className="mt-0.5 break-words">{row.lastSyncAt ? formatDate(row.lastSyncAt) : row.lastError || "—"}</dd></div>
              </dl>
            </article>
          ))}
        </div>
      )}
      {data.mappings.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-slate-400 lg:hidden">{legacyTextByFlag(L, "a286e9fdfb2e")}</p>
      )}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{legacyTextByFlag(L, "67403942504d")}</th>
              <th className="px-4 py-3">{legacyTextByFlag(L, "d59890269eb3")}</th>
              <th className="px-4 py-3">{legacyTextByFlag(L, "81a5b063f527")}</th>
              <th className="px-4 py-3 text-right">{legacyTextByFlag(L, "fcf865a68ac5")}</th>
              <th className="px-4 py-3 text-right">{legacyTextByFlag(L, "75dc5449a256")}</th>
              <th className="px-4 py-3">{legacyTextByFlag(L, "13053e86f1ba")}</th>
              <th className="px-4 py-3">{legacyTextByFlag(L, "1117ac6b3218")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {data.mappings.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">{legacyTextByFlag(L, "a286e9fdfb2e")}</td></tr>
            ) : data.mappings.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3">
                  <Link href={Routes.product(row.productId)} className="font-semibold text-primary-600 hover:underline">{row.productName}</Link>
                  <div className="text-xs text-slate-400">{row.sku}</div>
                </td>
                <td className="px-4 py-3"><Badge value="Shopee" /></td>
                <td className="px-4 py-3"><Badge value={row.status} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{row.price ? formatCurrency(Number(row.price)) : "—"}</td>
                <td className="px-4 py-3 text-right tabular-nums">{row.stock ? formatNumber(Number(row.stock)) : "—"}</td>
                <td className="px-4 py-3 font-mono text-xs">{row.externalItemId ?? "—"}</td>
                <td className="px-4 py-3 text-slate-500">{row.lastSyncAt ? formatDate(row.lastSyncAt) : row.lastError || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function OnlineOrdersSection({ rows, L }: { rows: Awaited<ReturnType<typeof getShopeeDashboard>>["orderMappings"]; L: boolean }) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
        <div>
          <h2 className="text-sm font-extrabold">{legacyTextByFlag(L, "68f38f3ae6c9")}</h2>
          <p className="text-xs text-slate-500">
            {legacyTextByFlag(L, "759346ac02cd")}
          </p>
        </div>
        <Link href={`${Routes.Sales}?tab=orders&source=shopee`} className="inline-flex h-11 items-center rounded-lg border border-border px-3 text-xs font-bold hover:bg-surface-2">
          {legacyTextByFlag(L, "f04690c8d203")}
        </Link>
      </div>
      {rows.length > 0 && (
        <div className="divide-y divide-border-soft lg:hidden" data-mobile-audit="online-orders">
          {rows.map((row) => (
            <article key={row.id} className="space-y-3 p-3 text-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="break-all font-mono text-xs font-semibold">{row.externalOrderSn}</div>
                  <div className="mt-1 break-words text-slate-600 dark:text-slate-300"><PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? "—"} /></div>
                </div>
                <Badge value={row.externalStatus} />
              </div>
              <div className="flex items-end justify-between gap-3">
                <div>
                  <div className="text-xs text-slate-500">{legacyTextByFlag(L, "ed786b9af2fe")}</div>
                  {row.orderId && row.orderCode ? (
                    <OrderDetailLink orderId={row.orderId} className="inline-flex min-h-11 min-w-11 items-center font-semibold text-primary-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500">
                      {row.orderCode}
                    </OrderDetailLink>
                  ) : "—"}
                </div>
                <div className="text-right">
                  <div className="font-semibold tabular-nums">{row.total ? formatCurrency(Number(row.total)) : "—"}</div>
                  <div className="mt-1 text-xs text-slate-500">{formatDate(row.importedAt)}</div>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
      {rows.length === 0 && (
        <p className="px-4 py-10 text-center text-sm text-slate-400 lg:hidden">{legacyTextByFlag(L, "93a4d6d0e7c7")}</p>
      )}
      <div className="hidden overflow-x-auto lg:block">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{legacyTextByFlag(L, "669b1519f34c")}</th>
              <th className="px-4 py-3">{legacyTextByFlag(L, "ed786b9af2fe")}</th>
              <th className="px-4 py-3">{legacyTextByFlag(L, "3b5afa5c941a")}</th>
              <th className="px-4 py-3">{legacyTextByFlag(L, "81a5b063f527")}</th>
              <th className="px-4 py-3 text-right">{legacyTextByFlag(L, "d213bb0e14cc")}</th>
              <th className="px-4 py-3">{legacyTextByFlag(L, "7e926945e5a4")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {rows.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">{legacyTextByFlag(L, "93a4d6d0e7c7")}</td></tr>
            ) : rows.map((row) => (
              <tr key={row.id}>
                <td className="px-4 py-3 font-mono text-xs">{row.externalOrderSn}</td>
                <td className="px-4 py-3">
                  {row.orderId && row.orderCode ? <OrderDetailLink orderId={row.orderId} className="font-semibold text-primary-600 hover:underline">{row.orderCode}</OrderDetailLink> : "—"}
                </td>
                <td className="px-4 py-3"><PartnerDetailLink kind="customer" partnerId={row.customerId} name={row.customerName ?? "—"} /></td>
                <td className="px-4 py-3"><Badge value={row.externalStatus} /></td>
                <td className="px-4 py-3 text-right tabular-nums">{row.total ? formatCurrency(Number(row.total)) : "—"}</td>
                <td className="px-4 py-3 text-slate-500">{formatDate(row.importedAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InboxSection({ threads, L }: { threads: Awaited<ReturnType<typeof getShopeeInbox>>["threads"]; L: boolean }) {
  return threads.length === 0 ? (
    <section className="rounded-card border border-dashed border-border bg-surface px-6 py-14 text-center text-sm text-slate-400">
      {legacyTextByFlag(L, "6c41e4eeeed7")}
    </section>
  ) : (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {threads.map((thread) => (
        <section key={thread.id} className="rounded-card border border-border bg-surface">
          <div className="border-b border-border-soft px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-extrabold">{thread.buyerName || thread.externalThreadId}</h2>
                <p className="truncate text-xs text-slate-500">Shopee · <PartnerDetailLink kind="customer" partnerId={thread.customerId} name={thread.customerName || (legacyTextByFlag(L, "0d79442a277a"))} />{thread.orderCode ? ` · ${thread.orderCode}` : ""}</p>
              </div>
              <Badge value={thread.status} />
            </div>
          </div>
          <div className="max-h-[360px] space-y-2 overflow-y-auto px-4 py-3">
            {thread.messages.map((message) => (
              <div key={message.id} className={`flex ${message.direction === "out" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-card px-3 py-2 text-sm ${message.direction === "out" ? "bg-primary-600 text-white" : "bg-canvas text-slate-800 dark:text-slate-100"}`}>
                  <div className="whitespace-pre-wrap">{message.body}</div>
                  <div className={`mt-1 text-[10px] ${message.direction === "out" ? "text-white/70" : "text-slate-400"}`}>{formatDate(message.sentAt)}</div>
                </div>
              </div>
            ))}
          </div>
          <form action={async (formData: FormData) => {
            "use server";
            await sendMarketplaceMessage({ threadId: thread.id, body: String(formData.get("body") ?? "") });
          }} className="flex gap-2 border-t border-border-soft px-4 py-3">
            <input name="body" className="flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-primary-500 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0" placeholder={legacyTextByFlag(L, "18840625afe9")} />
            <button className="inline-flex h-11 items-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:brightness-110">
              <Send className="h-4 w-4" /> {legacyTextByFlag(L, "e9c6acb3db1b")}
            </button>
          </form>
        </section>
      ))}
    </div>
  );
}

function SyncSection({ jobs, L }: { jobs: Awaited<ReturnType<typeof getShopeeDashboard>>["jobs"]; L: boolean }) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3">
        <RefreshCw className="h-4 w-4 text-primary-600" />
        <h2 className="text-sm font-extrabold">{legacyTextByFlag(L, "8dc1bf0c9bd7")}</h2>
      </div>
      <div className="divide-y divide-border-soft">
        {jobs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">{legacyTextByFlag(L, "b0c4adf5040a")}</div>
        ) : jobs.map((job) => (
          <div key={job.id} className="grid grid-cols-1 gap-2 px-4 py-3 text-sm md:grid-cols-[100px_180px_120px_1fr_160px]">
            <span className="font-semibold">Shopee</span>
            <span className="font-semibold">{job.jobType}</span>
            <Badge value={job.status} />
            <span className="min-w-0 truncate font-mono text-xs text-slate-500">{job.idempotencyKey}</span>
            <span className="text-slate-500">{formatDate(job.updatedAt)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function Metric({ title, value, muted, tone = "normal" }: { title: string; value: string; muted?: boolean; tone?: "normal" | "warn" }) {
  return (
    <div className="rounded-card border border-border bg-surface px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{title}</div>
      <div className={`mt-1 truncate text-lg font-extrabold ${muted ? "text-slate-400" : tone === "warn" ? "text-warn" : "text-slate-900 dark:text-slate-100"}`}>{value}</div>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const tone = value === "published" || value === "connected" || value === "authorized"
    ? "bg-ok-soft text-ok"
    : value === "failed"
      ? "bg-er-soft text-er"
      : value === "soon"
        ? "bg-surface-2 text-slate-400"
        : value === "available"
          ? "bg-in-soft text-in"
          : "bg-surface-2 text-slate-600";
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-bold ${tone}`}>{value}</span>;
}
