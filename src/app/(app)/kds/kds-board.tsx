"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { ChefHat, Check, Clock, CheckCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { setTicketItemStatus, serveTicket } from "@/lib/actions/kitchen";
import type { KdsItemStatus } from "@/lib/data/kitchen";

type Item = { id: string; productName: string; quantity: number; modifiers: { label: string; priceDelta: number }[]; note: string | null; status: KdsItemStatus };
type Ticket = { id: string; tableName: string; round: number; createdAtMs: number; items: Item[] };

const NEXT: Record<KdsItemStatus, KdsItemStatus | null> = { pending: "preparing", preparing: "ready", ready: "served", served: null };

function elapsed(ms: number) {
  const min = Math.floor((Date.now() - ms) / 60000);
  if (min < 60) return `${min}'`;
  return `${Math.floor(min / 60)}h${min % 60}`;
}

export function KdsBoard({ tickets }: { tickets: Ticket[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [, start] = useTransition();
  const [, force] = useState(0);

  // tự làm mới: cập nhật đồng hồ mỗi 20s + kéo dữ liệu mới
  useEffect(() => {
    const tick = setInterval(() => force((x) => x + 1), 20000);
    const refresh = setInterval(() => router.refresh(), 20000);
    return () => { clearInterval(tick); clearInterval(refresh); };
  }, [router]);

  function advance(itemId: string, status: KdsItemStatus) { start(async () => { await setTicketItemStatus(itemId, status); router.refresh(); }); }
  function serveAll(ticketId: string) { start(async () => { await serveTicket(ticketId); router.refresh(); }); }

  if (tickets.length === 0) {
    return <div className="bg-surface border border-dashed border-border rounded-card p-16 text-center text-slate-400"><ChefHat className="w-10 h-10 mx-auto mb-3 opacity-60" /><p className="font-medium">{t("kds.empty")}</p></div>;
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3 items-start">
      {tickets.map((tk) => {
        const min = (Date.now() - tk.createdAtMs) / 60000;
        const head = min > 10 ? "border-er bg-er/5" : min > 5 ? "border-warn bg-warn/5" : "border-border";
        return (
          <div key={tk.id} className={cn("bg-surface border rounded-card shadow-e1 overflow-hidden", head)}>
            <div className="px-3 py-2 border-b border-border flex items-center justify-between">
              <div className="font-bold text-sm">{tk.tableName} <span className="text-slate-400 font-normal">#{tk.round}</span></div>
              <span className={cn("text-xs font-mono flex items-center gap-1", min > 10 ? "text-er" : min > 5 ? "text-warn" : "text-slate-400")}><Clock className="w-3 h-3" />{elapsed(tk.createdAtMs)}</span>
            </div>
            <div className="divide-y divide-border-soft">
              {tk.items.map((it) => {
                const next = NEXT[it.status];
                return (
                  <div key={it.id} className="px-3 py-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-semibold text-sm flex items-center gap-1.5"><span className="font-mono text-primary-600">{it.quantity}×</span><span className="truncate">{it.productName}</span></div>
                        {it.modifiers.length > 0 && <div className="text-[11px] text-slate-500">{it.modifiers.map((m) => m.label).join(", ")}</div>}
                        {it.note && <div className="text-[11px] text-warn">“{it.note}”</div>}
                      </div>
                      <span className={cn("shrink-0 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-full", it.status === "pending" ? "bg-surface-2 text-slate-500" : it.status === "preparing" ? "bg-in-soft text-in" : "bg-ok-soft text-ok")}>{t(`kds.status.${it.status}`)}</span>
                    </div>
                    {next && (
                      <button onClick={() => advance(it.id, next)} className="mt-1.5 w-full inline-flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-semibold active:scale-[0.98]">
                        <Check className="w-3.5 h-3.5" />{t(`kds.action.${it.status}`)}
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
            <button onClick={() => serveAll(tk.id)} className="w-full px-3 py-2 border-t border-border text-xs font-semibold text-slate-500 hover:bg-surface-2 inline-flex items-center justify-center gap-1.5"><CheckCheck className="w-3.5 h-3.5" />{t("kds.serveAll")}</button>
          </div>
        );
      })}
    </div>
  );
}
