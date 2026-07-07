import Link from "next/link";
import { getLocale } from "next-intl/server";
import { ArrowLeft, Send } from "lucide-react";
import { getShopeeInbox } from "@/lib/data/marketplace";
import { sendMarketplaceMessage } from "@/lib/actions/marketplace";
import { Routes } from "@/lib/routes";
import { formatDate } from "@/lib/utils";

export default async function ShopeeInboxPage() {
  const locale = await getLocale();
  const L = locale === "vi";
  const { threads } = await getShopeeInbox();

  return (
    <div className="p-4 sm:p-6 space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <Link href={Routes.Shopee} className="inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-primary-600">
            <ArrowLeft className="h-4 w-4" /> Shopee
          </Link>
          <h1 className="mt-2 text-2xl font-extrabold tracking-tight">{L ? "Shopee Inbox" : "Shopee Inbox"}</h1>
          <p className="mt-1 text-sm text-slate-500">{L ? "Tin nhắn khách hàng được lưu vào LumaPOS và queue gửi qua Shopee adapter." : "Customer messages are logged in LumaPOS and queued for the Shopee adapter."}</p>
        </div>
      </div>

      {threads.length === 0 ? (
        <div className="rounded-card border border-dashed border-border bg-surface px-6 py-14 text-center text-sm text-slate-400">
          {L ? "Chưa có hội thoại Shopee." : "No Shopee conversations yet."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {threads.map((thread) => (
            <section key={thread.id} className="rounded-card border border-border bg-surface">
              <div className="border-b border-border-soft px-4 py-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="truncate text-sm font-extrabold">{thread.buyerName || thread.externalThreadId}</h2>
                    <p className="truncate text-xs text-slate-500">
                      {thread.customerName || (L ? "Chưa liên kết khách hàng" : "No linked customer")}
                      {thread.orderCode ? ` · ${thread.orderCode}` : ""}
                    </p>
                  </div>
                  <span className="rounded-md bg-surface-2 px-2 py-1 text-xs font-bold text-slate-600">{thread.status}</span>
                </div>
              </div>
              <div className="max-h-[360px] space-y-2 overflow-y-auto px-4 py-3">
                {thread.messages.length === 0 ? (
                  <div className="rounded-card border border-dashed border-border-soft px-4 py-8 text-center text-xs text-slate-400">
                    {L ? "Chưa có tin nhắn trong thread này." : "No messages in this thread."}
                  </div>
                ) : thread.messages.map((message) => (
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
      )}
    </div>
  );
}
