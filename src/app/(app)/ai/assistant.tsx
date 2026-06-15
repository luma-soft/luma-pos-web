"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Sparkles, Send, Info } from "lucide-react";
import { cn } from "@/lib/utils";

type Msg = { role: "user" | "assistant"; text: string };

export function Assistant() {
  const t = useTranslations();
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);

  const suggestions = [
    t("ai.q.todaySales"), t("ai.q.topSellers"), t("ai.q.lowStock"), t("ai.q.restockToday"),
  ];

  function send(text: string) {
    const q = text.trim();
    if (!q) return;
    setMsgs((m) => [...m, { role: "user", text: q }, { role: "assistant", text: t("ai.placeholderReply") }]);
    setInput("");
  }

  return (
    <div className="max-w-2xl mx-auto">
      <div className="flex items-start gap-2 mb-4 px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-card text-[12px] text-in">
        <Info className="w-4 h-4 shrink-0 mt-px" />
        <span>{t("ai.assistantNotice")}</span>
      </div>

      <div className="bg-surface border border-border rounded-card shadow-e1 flex flex-col h-[60vh]">
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
          {msgs.length === 0 ? (
            <div className="m-auto text-center text-slate-400">
              <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-60" />
              <p className="text-sm font-medium">{t("ai.assistantEmpty")}</p>
            </div>
          ) : msgs.map((m, i) => (
            <div key={i} className={cn("max-w-[80%] px-3.5 py-2 rounded-2xl text-sm", m.role === "user" ? "self-end bg-primary-600 text-white" : "self-start bg-surface-2")}>
              {m.text}
            </div>
          ))}
        </div>

        <div className="px-3 pt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => send(s)} className="px-2.5 py-1 rounded-full border border-border text-xs text-slate-600 dark:text-slate-300 hover:bg-surface-2">{s}</button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="p-3 flex items-center gap-2 border-t border-border mt-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("ai.askPlaceholder")} className="flex-1 px-3 py-2 text-sm rounded-full border border-border bg-canvas focus:outline-none focus:ring-2 focus:ring-primary-500" />
          <button type="submit" className="w-9 h-9 grid place-items-center rounded-full bg-primary-600 text-white shrink-0"><Send className="w-4 h-4" /></button>
        </form>
      </div>
    </div>
  );
}
