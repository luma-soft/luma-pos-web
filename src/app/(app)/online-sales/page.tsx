import Link from "next/link";
import { getLocale } from "next-intl/server";
import { Boxes, ExternalLink, Inbox, Layers3, RefreshCw, Send, ShoppingBag, Store } from "lucide-react";
import { getShopeeDashboard, getShopeeInbox } from "@/lib/data/marketplace";
import { sendMarketplaceMessage } from "@/lib/actions/marketplace";
import { Routes } from "@/lib/routes";
import { cn, formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { disconnectShopeeShop } from "@/lib/actions/marketplace";

type SP = Record<string, string | undefined>;
type OnlineSalesTab = "overview" | "channels" | "listings" | "orders" | "inbox" | "sync";

const TABS: OnlineSalesTab[] = ["overview", "channels", "listings", "orders", "inbox", "sync"];
const PROVIDERS = [
  { id: "shopee", name: "Shopee", ready: true },
  { id: "tiktok_shop", name: "TikTok Shop", ready: false },
  { id: "lazada", name: "Lazada", ready: false },
  { id: "tiki", name: "Tiki", ready: false },
] as const;

export default async function OnlineSalesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const locale = await getLocale();
  const L = locale === "vi";
  const params = await searchParams;
  const tab = TABS.includes(params.tab as OnlineSalesTab) ? params.tab as OnlineSalesTab : "overview";
  const [data, inbox] = await Promise.all([getShopeeDashboard(), getShopeeInbox()]);
  const shop = data.shop;
  const connectedChannels = shop && ["connected", "authorized"].includes(shop.status) ? 1 : 0;
  const onlineOrderCount = data.jobs.filter((job) => job.jobType.includes("order")).length;

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-primary-600">{L ? "Bán online" : "Online sales"}</div>
          <h1 className="text-2xl font-extrabold tracking-tight">{L ? "Kênh bán hàng online" : "Online sales channels"}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {L
              ? "Quản lý gian hàng, listing, đơn hàng, inbox và đồng bộ tồn kho trên Shopee, TikTok Shop, Lazada, Tiki."
              : "Manage shops, listings, orders, inbox, and stock sync across Shopee, TikTok Shop, Lazada, and Tiki."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={tabHref("inbox")} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2">
            <Inbox className="h-4 w-4" /> {L ? "Inbox" : "Inbox"}
          </Link>
          <Link href="/settings?tab=shopee" className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2">
            <Store className="h-4 w-4" /> {L ? "Developer apps" : "Developer apps"}
          </Link>
          <Link href={tabHref("channels")} className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
            <ShoppingBag className="h-4 w-4" /> {L ? "Thêm kênh" : "Add channel"}
          </Link>
        </div>
      </div>

      <div className="flex gap-1 overflow-x-auto border-b border-border">
        {TABS.map((item) => (
          <Link
            key={item}
            href={tabHref(item)}
            className={cn(
              "shrink-0 border-b-2 px-3 py-2 text-sm font-semibold",
              tab === item ? "border-primary-600 text-primary-600" : "border-transparent text-slate-500 hover:text-slate-900 dark:hover:text-slate-200",
            )}
          >
            {tabLabel(item, L)}
          </Link>
        ))}
      </div>

      {(tab === "overview" || tab === "channels") && (
        <>
          <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <Metric title={L ? "Kênh đã kết nối" : "Connected channels"} value={formatNumber(connectedChannels)} muted={connectedChannels === 0} />
            <Metric title={L ? "Listing online" : "Online listings"} value={formatNumber(data.metrics.listings)} />
            <Metric title={L ? "Đơn online" : "Online orders"} value={formatNumber(onlineOrderCount)} />
            <Metric title={L ? "Queue lỗi/chờ" : "Failed/Pending"} value={`${formatNumber(data.metrics.failedJobs)} / ${formatNumber(data.metrics.pendingJobs)}`} tone={data.metrics.failedJobs > 0 ? "warn" : "normal"} />
          </section>

          <section className="rounded-card border border-border bg-surface">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
              <div>
                <h2 className="text-sm font-extrabold">{L ? "Kênh bán hàng" : "Sales channels"}</h2>
                <p className="text-xs text-slate-500">{L ? "Kết nối gian hàng và cấu hình chính sách đồng bộ theo từng sàn." : "Connect shops and configure sync policy per marketplace."}</p>
              </div>
              <Link href={tabHref("channels")} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-bold hover:bg-surface-2">
                <Layers3 className="h-3.5 w-3.5" /> {L ? "Quản lý kênh" : "Manage channels"}
              </Link>
            </div>
            <div className="grid grid-cols-1 gap-3 p-4 md:grid-cols-2 xl:grid-cols-4">
              {PROVIDERS.map((provider) => (
                <ProviderCard key={provider.id} provider={provider} shop={provider.id === "shopee" ? shop : null} L={L} />
              ))}
            </div>
          </section>
        </>
      )}

      {tab === "listings" || tab === "overview" ? <ListingsSection data={data} L={L} /> : null}
      {tab === "orders" && <OnlineOrdersSection L={L} />}
      {tab === "inbox" && <InboxSection threads={inbox.threads} L={L} />}
      {tab === "sync" || tab === "overview" ? <SyncSection jobs={data.jobs} L={L} /> : null}
    </div>
  );
}

function tabHref(tab: OnlineSalesTab) {
  return `${Routes.OnlineSales}?tab=${tab}`;
}

function tabLabel(tab: OnlineSalesTab, L: boolean) {
  const labels: Record<OnlineSalesTab, [string, string]> = {
    overview: ["Overview", "Tổng quan"],
    channels: ["Channels", "Kênh bán"],
    listings: ["Listings", "Listing"],
    orders: ["Orders", "Đơn online"],
    inbox: ["Inbox", "Inbox"],
    sync: ["Sync logs", "Sync logs"],
  };
  return L ? labels[tab][1] : labels[tab][0];
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
              ? connected ? `${shop?.shopName || shop?.shopId} · ${shop?.status}` : (L ? "Sẵn sàng kết nối" : "Ready to connect")
              : (L ? "Sắp hỗ trợ" : "Coming soon")}
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
              <button className="w-full rounded-full border border-border px-3 py-2 text-xs font-bold hover:bg-surface-2">{L ? "Ngắt kết nối" : "Disconnect"}</button>
            </form>
          ) : (
            <Link href="/api/shopee/connect" className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-primary-600 px-3 py-2 text-xs font-bold text-white hover:brightness-110">
              <ExternalLink className="h-3.5 w-3.5" /> {L ? "Kết nối" : "Connect"}
            </Link>
          )
        ) : (
          <button disabled className="w-full rounded-full border border-border px-3 py-2 text-xs font-bold text-slate-400">{L ? "Sắp ra mắt" : "Coming soon"}</button>
        )}
      </div>
    </div>
  );
}

function ListingsSection({ data, L }: { data: Awaited<ReturnType<typeof getShopeeDashboard>>; L: boolean }) {
  return (
    <section className="rounded-card border border-border bg-surface">
      <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
        <div>
          <h2 className="text-sm font-extrabold">{L ? "Listing sản phẩm" : "Product listings"}</h2>
          <p className="text-xs text-slate-500">{L ? "Listing đã lưu draft hoặc publish theo từng kênh bán online." : "Drafted or published listings per online sales channel."}</p>
        </div>
        <Link href={`${Routes.Inventory}?tab=products`} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-bold hover:bg-surface-2">
          <Boxes className="h-3.5 w-3.5" /> {L ? "Chọn sản phẩm" : "Select product"}
        </Link>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-4 py-3">{L ? "Sản phẩm" : "Product"}</th>
              <th className="px-4 py-3">{L ? "Kênh" : "Channel"}</th>
              <th className="px-4 py-3">{L ? "Trạng thái" : "Status"}</th>
              <th className="px-4 py-3 text-right">{L ? "Giá" : "Price"}</th>
              <th className="px-4 py-3 text-right">{L ? "Tồn" : "Stock"}</th>
              <th className="px-4 py-3">{L ? "Mã sàn" : "Marketplace item"}</th>
              <th className="px-4 py-3">{L ? "Sync cuối" : "Last sync"}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border-soft">
            {data.mappings.length === 0 ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-slate-400">{L ? "Chưa có listing online." : "No online listings yet."}</td></tr>
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

function OnlineOrdersSection({ L }: { L: boolean }) {
  return (
    <section className="rounded-card border border-border bg-surface px-4 py-10 text-center">
      <ShoppingBag className="mx-auto h-8 w-8 text-primary-500" />
      <h2 className="mt-3 text-sm font-extrabold">{L ? "Đơn online tập trung" : "Centralized online orders"}</h2>
      <p className="mx-auto mt-1 max-w-xl text-sm text-slate-500">
        {L ? "Đơn từ Shopee, TikTok Shop, Lazada và Tiki sẽ về một luồng xử lý. Hiện đơn Shopee cũng xuất hiện trong Đơn hàng với badge kênh." : "Orders from Shopee, TikTok Shop, Lazada, and Tiki will share one handling flow. Shopee orders also appear in Orders with a channel badge."}
      </p>
      <Link href={`${Routes.Sales}?tab=orders&source=shopee`} className="mt-4 inline-flex rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2">
        {L ? "Xem đơn Shopee" : "View Shopee orders"}
      </Link>
    </section>
  );
}

function InboxSection({ threads, L }: { threads: Awaited<ReturnType<typeof getShopeeInbox>>["threads"]; L: boolean }) {
  return threads.length === 0 ? (
    <section className="rounded-card border border-dashed border-border bg-surface px-6 py-14 text-center text-sm text-slate-400">
      {L ? "Chưa có hội thoại online." : "No online conversations yet."}
    </section>
  ) : (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      {threads.map((thread) => (
        <section key={thread.id} className="rounded-card border border-border bg-surface">
          <div className="border-b border-border-soft px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-sm font-extrabold">{thread.buyerName || thread.externalThreadId}</h2>
                <p className="truncate text-xs text-slate-500">Shopee · {thread.customerName || (L ? "Chưa liên kết khách hàng" : "No linked customer")}{thread.orderCode ? ` · ${thread.orderCode}` : ""}</p>
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
            <input name="body" className="min-w-0 flex-1 rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-primary-500" placeholder={L ? "Nhập phản hồi..." : "Type a reply..."} />
            <button className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
              <Send className="h-4 w-4" /> {L ? "Gửi" : "Send"}
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
        <h2 className="text-sm font-extrabold">{L ? "Sync logs" : "Sync logs"}</h2>
      </div>
      <div className="divide-y divide-border-soft">
        {jobs.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-slate-400">{L ? "Chưa có job đồng bộ." : "No sync jobs yet."}</div>
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
