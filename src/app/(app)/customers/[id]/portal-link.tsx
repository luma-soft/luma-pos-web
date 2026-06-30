"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Link2, Loader2, MessageCircle } from "lucide-react";
import { generatePortalToken } from "@/lib/actions/extras";
import { sendCustomerPortalZalo } from "@/lib/actions/zalo";

export function PortalLink({ customerId, token, zaloConfigured }: { customerId: string; token: string | null; zaloConfigured: boolean }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [sendingZalo, setSendingZalo] = useState(false);
  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState("");

  const url = token && typeof window !== "undefined" ? `${window.location.origin}/portal/${token}` : null;

  async function generate() {
    setBusy(true);
    const res = await generatePortalToken(customerId);
    setBusy(false);
    if (res.ok) router.refresh();
  }

  async function copy() {
    if (!url) return;
    await navigator.clipboard.writeText(url);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function sendZalo() {
    if (!url || sendingZalo) return;
    setSendingZalo(true);
    setStatus("");
    const res = await sendCustomerPortalZalo({ customerId, url });
    setSendingZalo(false);
    setStatus(res.ok ? t("zalo.sent") : t(res.error as never));
  }

  return (
    <div className="bg-surface border border-border rounded-card p-4 text-sm">
      <h2 className="font-semibold mb-2 flex items-center gap-2"><Link2 className="w-4 h-4" />{t("portal.linkTitle")}</h2>
      {token ? (
        <>
          <p className="text-xs text-slate-500 break-all bg-slate-50 dark:bg-slate-800 rounded-lg p-2">{url ?? `/portal/${token}`}</p>
          <div className="flex gap-2 mt-2">
            <button onClick={copy} className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium">
              {copied ? t("portal.copied") : t("portal.copy")}
            </button>
            <button onClick={generate} disabled={busy} className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium disabled:opacity-50">
              {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : t("portal.regenerate")}
            </button>
            {zaloConfigured && (
              <button onClick={sendZalo} disabled={sendingZalo} className="px-3 py-1.5 rounded-lg border border-border text-xs font-medium disabled:opacity-50 inline-flex items-center gap-1.5">
                {sendingZalo ? <Loader2 className="w-3 h-3 animate-spin" /> : <MessageCircle className="w-3 h-3" />}
                {t("zalo.send")}
              </button>
            )}
          </div>
          <p className="text-[11px] text-slate-400 mt-2">{t("portal.hint")}</p>
          {status && <p className="text-[11px] text-slate-500 mt-2">{status}</p>}
        </>
      ) : (
        <>
          <p className="text-xs text-slate-500 mb-2">{t("portal.desc")}</p>
          <button onClick={generate} disabled={busy} className="px-3 py-1.5 rounded-lg bg-primary-600 text-white text-xs font-medium disabled:opacity-50 inline-flex items-center gap-2">
            {busy && <Loader2 className="w-3 h-3 animate-spin" />}
            {t("portal.generate")}
          </button>
        </>
      )}
    </div>
  );
}
