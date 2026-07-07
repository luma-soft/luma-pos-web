import Link from "next/link";
import { getLocale } from "next-intl/server";
import { Boxes, ExternalLink, Inbox, RefreshCw, Store, TriangleAlert } from "lucide-react";
import { getShopeeDashboard } from "@/lib/data/marketplace";
import { Routes } from "@/lib/routes";
import { formatCurrency, formatDate, formatNumber } from "@/lib/utils";
import { disconnectShopeeShop } from "@/lib/actions/marketplace";

export default async function ShopeePage() {
  const locale = await getLocale();
  const L = locale === "vi";
  const data = await getShopeeDashboard();
  const shop = data.shop;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-primary-600">Shopee</div>
          <h1 className="text-2xl font-extrabold tracking-tight">{L ? "Kênh bán hàng Shopee" : "Shopee marketplace"}</h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-500">
            {L
              ? "Quản lý listing, đơn hàng, tồn kho, tin nhắn và queue đồng bộ Shopee từ LumaPOS."
              : "Manage Shopee listings, orders, stock, messages, and sync jobs from LumaPOS."}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={Routes.ShopeeInbox} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2">
            <Inbox className="h-4 w-4" /> {L ? "Inbox" : "Inbox"}
          </Link>
          <Link href="/settings?tab=shopee" className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110">
            <Store className="h-4 w-4" /> {L ? "Cấu hình" : "Settings"}
          </Link>
        </div>
      </div>

      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <Metric title={L ? "Shop" : "Shop"} value={shop?.shopName || (L ? "Chưa kết nối" : "Not connected")} muted={!shop} />
        <Metric title={L ? "Listing" : "Listings"} value={formatNumber(data.metrics.listings)} />
        <Metric title={L ? "Đã publish" : "Published"} value={formatNumber(data.metrics.publishedListings)} />
        <Metric title={L ? "Queue lỗi/chờ" : "Failed/Pending"} value={`${formatNumber(data.metrics.failedJobs)} / ${formatNumber(data.metrics.pendingJobs)}`} tone={data.metrics.failedJobs > 0 ? "warn" : "normal"} />
      </section>

      <section className="rounded-card border border-border bg-surface">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
          <div>
            <h2 className="text-sm font-extrabold">{L ? "Kết nối Shopee" : "Shopee connection"}</h2>
            <p className="text-xs text-slate-500">
              {shop
                ? `${shop.shopId} · ${shop.status} · ${shop.tokenExpiresAt ? formatDate(shop.tokenExpiresAt) : ""}`
                : (L ? "Cần partner credential và OAuth từ Shopee Open Platform để dùng production." : "Production requires partner credentials and OAuth from Shopee Open Platform.")}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!shop || shop.status !== "connected" ? (
              <Link href="/api/shopee/connect" className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-xs font-bold text-white hover:brightness-110">
                <ExternalLink className="h-3.5 w-3.5" /> {L ? "Kết nối Shopee" : "Connect Shopee"}
              </Link>
            ) : (
              <form action={async () => {
                "use server";
                await disconnectShopeeShop(shop.id);
              }}>
                <button className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-xs font-bold hover:bg-surface-2">
                  {L ? "Ngắt kết nối" : "Disconnect"}
                </button>
              </form>
            )}
          </div>
        </div>
        {shop?.lastError && (
          <div className="flex items-start gap-2 border-b border-warn/20 bg-warn-soft px-4 py-3 text-xs text-warn">
            <TriangleAlert className="mt-0.5 h-4 w-4" />
            <span>{shop.lastError}</span>
          </div>
        )}
        <div className="grid grid-cols-1 divide-y divide-border-soft md:grid-cols-3 md:divide-x md:divide-y-0">
          <StatusCell label={L ? "Trạng thái" : "Status"} value={shop?.status ?? "disconnected"} />
          <StatusCell label={L ? "Lần sync cuối" : "Last sync"} value={shop?.lastSyncAt ? formatDate(shop.lastSyncAt) : "—"} />
          <StatusCell label={L ? "Vùng" : "Region"} value={shop?.region ?? "VN"} />
        </div>
      </section>

      <section className="rounded-card border border-border bg-surface">
        <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
          <div>
            <h2 className="text-sm font-extrabold">{L ? "Listing sản phẩm" : "Product listings"}</h2>
            <p className="text-xs text-slate-500">{L ? "Các sản phẩm LumaPOS đã lưu draft hoặc publish lên Shopee." : "LumaPOS products saved as Shopee drafts or published listings."}</p>
          </div>
          <Link href={`${Routes.Inventory}?tab=products`} className="inline-flex items-center gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-bold hover:bg-surface-2">
            <Boxes className="h-3.5 w-3.5" /> {L ? "Chọn sản phẩm" : "Select product"}
          </Link>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-canvas text-left text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">{L ? "Sản phẩm" : "Product"}</th>
                <th className="px-4 py-3">{L ? "Trạng thái" : "Status"}</th>
                <th className="px-4 py-3 text-right">{L ? "Giá" : "Price"}</th>
                <th className="px-4 py-3 text-right">{L ? "Tồn" : "Stock"}</th>
                <th className="px-4 py-3">{L ? "Shopee item" : "Shopee item"}</th>
                <th className="px-4 py-3">{L ? "Sync cuối" : "Last sync"}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-soft">
              {data.mappings.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-slate-400">{L ? "Chưa có listing Shopee." : "No Shopee listings yet."}</td></tr>
              ) : data.mappings.map((row) => (
                <tr key={row.id}>
                  <td className="px-4 py-3">
                    <Link href={Routes.product(row.productId)} className="font-semibold text-primary-600 hover:underline">{row.productName}</Link>
                    <div className="text-xs text-slate-400">{row.sku}</div>
                  </td>
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

      <section className="rounded-card border border-border bg-surface">
        <div className="flex items-center gap-2 border-b border-border-soft px-4 py-3">
          <RefreshCw className="h-4 w-4 text-primary-600" />
          <h2 className="text-sm font-extrabold">{L ? "Sync queue" : "Sync queue"}</h2>
        </div>
        <div className="divide-y divide-border-soft">
          {data.jobs.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">{L ? "Chưa có job đồng bộ." : "No sync jobs yet."}</div>
          ) : data.jobs.map((job) => (
            <div key={job.id} className="grid grid-cols-1 gap-2 px-4 py-3 text-sm md:grid-cols-[180px_120px_1fr_160px]">
              <span className="font-semibold">{job.jobType}</span>
              <Badge value={job.status} />
              <span className="min-w-0 truncate font-mono text-xs text-slate-500">{job.idempotencyKey}</span>
              <span className="text-slate-500">{formatDate(job.updatedAt)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
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

function StatusCell({ label, value }: { label: string; value: string }) {
  return (
    <div className="px-4 py-3">
      <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-1 text-sm font-semibold">{value}</div>
    </div>
  );
}

function Badge({ value }: { value: string }) {
  const tone = value === "published" || value === "connected" || value === "done"
    ? "bg-ok-soft text-ok"
    : value === "failed"
      ? "bg-er-soft text-er"
      : "bg-surface-2 text-slate-600";
  return <span className={`inline-flex rounded-md px-2 py-1 text-xs font-bold ${tone}`}>{value}</span>;
}
