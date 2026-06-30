"use client";

import { useMemo, useState } from "react";
import { Loader2, Share2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { buttonVariants } from "@/components/ui/button-variants";
import { buildPrintShareFileName, createPrintShareFile, type ShareablePrintDocType } from "@/lib/print/share-document";
import { cn } from "@/lib/utils";

type ShareStatus = "copied" | "opened" | "unsupported" | null;

const SHARE_TITLE_KEYS: Record<ShareablePrintDocType, "print.shareTitles.order" | "print.shareTitles.quote" | "print.shareTitles.booking"> = {
  order: "print.shareTitles.order",
  quote: "print.shareTitles.quote",
  booking: "print.shareTitles.booking",
};

interface SharePrintDocButtonProps {
  href: string;
  code: string;
  docType: ShareablePrintDocType;
}

export function SharePrintDocButton({ href, code, docType }: SharePrintDocButtonProps) {
  const t = useTranslations();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ShareStatus>(null);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return href;
    return new URL(href, window.location.origin).toString();
  }, [href]);

  const title = t(SHARE_TITLE_KEYS[docType], { code });
  const label = busy
    ? t("print.sharePreparing")
    : status === "copied"
      ? t("print.shareCopied")
      : status === "opened"
        ? t("print.shareOpened")
        : status === "unsupported"
          ? t("print.shareUnsupported")
          : t("print.shareBtn");

  const clearStatusSoon = () => {
    window.setTimeout(() => setStatus(null), 2200);
  };

  const openPrintUrl = () => {
    window.open(shareUrl, "_blank", "noopener,noreferrer");
  };

  const handleShare = async () => {
    if (busy) return;
    setBusy(true);
    setStatus(null);

    try {
      const fileName = buildPrintShareFileName(docType, code);
      const file = await createPrintShareFile();
      if (file && navigator.canShare?.({ files: [file] })) {
        await navigator.share({ title, files: [new File([file], fileName, { type: file.type || "application/pdf" })] });
        return;
      }

      if (navigator.share) {
        await navigator.share({ title, text: title, url: shareUrl });
        return;
      }

      let copied = false;
      try {
        await navigator.clipboard.writeText(shareUrl);
        copied = true;
        setStatus("copied");
      } catch {
        setStatus("unsupported");
      }
      openPrintUrl();
      if (!copied) setStatus("opened");
      clearStatusSoon();
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setStatus("unsupported");
      openPrintUrl();
      clearStatusSoon();
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      onClick={handleShare}
      disabled={busy}
      className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-9 bg-white dark:bg-surface")}
      aria-live="polite"
    >
      {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Share2 className="mr-2 h-4 w-4" />}
      {label}
    </button>
  );
}
