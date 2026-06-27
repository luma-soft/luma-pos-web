"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, Info, Send, Sparkles, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AiActionPreview, AiAssistantState } from "@/lib/ai/actions";

type PreviewResolutionState = AiAssistantState | "confirmed" | "cancelled";

type Msg = {
  role: "user" | "assistant";
  text: string;
  state?: PreviewResolutionState;
  preview?: AiActionPreview;
  result?: string;
  record?: {
    type: string;
    id: string;
    code: string;
    href: string;
  };
};

type AssistantResponse = {
  text: string;
  state?: AiAssistantState;
  actionPreview?: AiActionPreview;
};

async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json?.data ?? json;
}

export function Assistant() {
  const t = useTranslations();
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  const suggestions = [
    t("ai.q.todaySales"),
    t("ai.q.topSellers"),
    t("ai.q.lowStock"),
    t("ai.q.restockToday"),
    "Nhập 20 thùng cà phê Robusta vào kho chính",
    "Đặt giá SKU A là 120.000",
  ];

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy) return;
    setMsgs((m) => [...m, { role: "user", text: q }]);
    setInput("");
    setBusy(true);
    try {
      const data = await postJson("/api/mobile/ai/assistant", { prompt: q }) as AssistantResponse;
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          text: data.text,
          state: data.state,
          preview: data.actionPreview,
        },
      ]);
    } catch (e) {
      setMsgs((m) => [
        ...m,
        {
          role: "assistant",
          text: e instanceof Error ? e.message : t("errors.serverError"),
          state: "failed",
        },
      ]);
    } finally {
      setBusy(false);
    }
  }

  async function resolvePreview(index: number, event: "confirmed" | "cancelled") {
    const msg = msgs[index];
    if (!msg.preview || busy) return;
    setBusy(true);
    try {
      const result = await postJson("/api/mobile/ai/actions", {
        event,
        prompt: msg.preview.action.payload.prompt,
        actionPreview: msg.preview,
        surface: "web",
      }) as {
        message?: string;
        record?: Msg["record"];
        status?: PreviewResolutionState;
      };
      setMsgs((m) => m.map((item, i) => i === index
        ? {
            ...item,
            state: result.status ?? event,
            result: result.message ?? (event === "confirmed" ? "Confirmed" : "Cancelled"),
            record: result.record,
          }
        : item));
    } catch (e) {
      setMsgs((m) => m.map((item, i) => i === index
        ? { ...item, state: "failed", result: e instanceof Error ? e.message : t("errors.serverError") }
        : item));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-start gap-2 mb-4 px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-card text-[12px] text-in">
        <Info className="w-4 h-4 shrink-0 mt-px" />
        <span>Action framework preview - AI sẽ tạo nháp, ghi audit, và chờ xác nhận trước khi mutate dữ liệu.</span>
      </div>

      <div className="bg-surface border border-border rounded-card shadow-e1 flex flex-col h-[68vh]">
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-canvas/50">
          {msgs.length === 0 ? (
            <div className="m-auto text-center text-slate-400">
              <Sparkles className="w-10 h-10 mx-auto mb-3 opacity-60" />
              <p className="text-sm font-medium">{t("ai.assistantEmpty")}</p>
            </div>
          ) : msgs.map((m, i) => (
            <div key={i} className={cn("flex flex-col gap-2", m.role === "user" ? "items-end" : "items-start")}>
              <div className={cn(
                "max-w-[82%] px-3.5 py-2 rounded-2xl text-sm",
                m.role === "user" ? "bg-primary-600 text-white rounded-tr-md" : "bg-surface border border-border rounded-tl-md"
              )}>
                {m.text}
              </div>
              {m.preview && (
                <PreviewCard
                  preview={m.preview}
                  state={m.state}
                  result={m.result}
                  record={m.record}
                  busy={busy}
                  onConfirm={() => resolvePreview(i, "confirmed")}
                  onCancel={() => resolvePreview(i, "cancelled")}
                />
              )}
            </div>
          ))}
          {busy && <div className="self-start text-xs text-slate-400 px-3 py-2">Đang xử lý...</div>}
        </div>

        <div className="px-3 pt-2 flex flex-wrap gap-1.5">
          {suggestions.map((s, i) => (
            <button key={i} onClick={() => send(s)} className="px-2.5 py-1 rounded-full border border-border text-xs text-slate-600 dark:text-slate-300 hover:bg-surface-2">{s}</button>
          ))}
        </div>

        <form onSubmit={(e) => { e.preventDefault(); send(input); }} className="p-3 flex items-center gap-2 border-t border-border mt-2">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder={t("ai.askPlaceholder")} className="flex-1 px-3 py-2 text-sm rounded-full border border-border bg-canvas focus:outline-none focus:ring-2 focus:ring-primary-500" />
          <button disabled={busy} type="submit" className="w-9 h-9 grid place-items-center rounded-full bg-primary-600 text-white shrink-0 disabled:opacity-50"><Send className="w-4 h-4" /></button>
        </form>
      </div>
    </div>
  );
}

function PreviewCard({
  preview,
  state,
  result,
  record,
  busy,
  onConfirm,
  onCancel,
}: {
  preview: AiActionPreview;
  state?: PreviewResolutionState;
  result?: string;
  record?: Msg["record"];
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const isConfirmed = state === "confirmed";
  const succeeded = state === "succeeded";
  const done = isConfirmed || succeeded || state === "cancelled";
  const canConfirm = preview.state === "preview" && preview.missingFields.length === 0;
  return (
    <div className="w-full max-w-2xl bg-surface border border-border rounded-card shadow-e1 overflow-hidden">
      <div className="p-3 border-b border-border-soft flex items-start justify-between gap-3">
        <div>
          <div className="font-bold text-sm">{preview.title}</div>
          <div className="text-[11px] text-slate-400 mt-0.5">
            {preview.intent} · confidence {Math.round(preview.confidence * 100)}%
          </div>
        </div>
        <span className={cn(
          "rounded-full px-2.5 py-0.5 text-[11px] font-bold",
          preview.strongConfirmation ? "bg-warn-soft text-warn" : "bg-primary-50 text-primary-700"
        )}>
          {preview.strongConfirmation ? "Strong confirm" : "Preview"}
        </span>
      </div>
      <div className="p-3 space-y-3">
        <div className="grid sm:grid-cols-2 gap-2">
          {preview.fields.map((field) => (
            <div key={field.label} className="rounded-lg bg-canvas border border-border-soft p-2">
              <div className="text-[10px] uppercase tracking-wide text-slate-400 font-bold">{field.label}</div>
              <div className={cn("text-sm font-semibold mt-0.5", field.tone === "warning" && "text-warn", field.tone === "danger" && "text-er")}>{field.value}</div>
            </div>
          ))}
        </div>
        {preview.lines.length > 0 && (
          <div className="rounded-lg border border-border overflow-hidden">
            {preview.lines.map((line) => (
              <div key={`${line.label}-${line.value}`} className="flex items-start justify-between gap-3 p-2.5 border-b border-border-soft last:border-0">
                <div className="min-w-0">
                  <div className="text-sm font-semibold truncate">{line.label}</div>
                  {line.meta && <div className="text-[11px] text-slate-400 mt-0.5">{line.meta}</div>}
                </div>
                <div className={cn("text-sm font-mono font-bold", line.tone === "danger" ? "text-er" : line.tone === "warning" ? "text-warn" : "text-primary-600")}>{line.value}</div>
              </div>
            ))}
          </div>
        )}
        {preview.missingFields.length > 0 && (
          <div className="rounded-lg bg-warn-soft text-warn p-2.5 text-xs font-semibold">
            Cần bổ sung: {preview.missingFields.join(", ")}
          </div>
        )}
        {preview.warnings.map((warning) => (
          <div key={warning} className="rounded-lg bg-surface-2 p-2.5 text-xs text-slate-500">{warning}</div>
        ))}
      </div>
      <div className="p-3 bg-surface-2 border-t border-border flex items-center justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-slate-400">{result ?? "Preview đã được ghi audit."}</div>
          {record && (
            <a href={record.href} className="mt-1 block text-xs font-bold text-primary-600 hover:underline">
              Mở PO nháp {record.code}
            </a>
          )}
        </div>
        {done ? (
          <span className={cn("inline-flex items-center gap-1 text-xs font-bold", isConfirmed || succeeded ? "text-ok" : "text-slate-500")}>
            {isConfirmed || succeeded ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
            {state}
          </span>
        ) : (
          <div className="flex gap-2">
            <button disabled={busy} onClick={onCancel} className="px-3 py-1.5 rounded-lg border border-border text-xs font-bold text-slate-500 disabled:opacity-50">Hủy</button>
            <button disabled={busy || !canConfirm} onClick={onConfirm} className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-bold disabled:opacity-50">Xác nhận</button>
          </div>
        )}
      </div>
    </div>
  );
}
