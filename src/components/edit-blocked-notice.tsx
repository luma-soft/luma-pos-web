import Link from "next/link";
import { getTranslations } from "next-intl/server";

/**
 * Shown instead of an edit form when the document can no longer be edited:
 * an edit opened from a page loaded before the document was cancelled,
 * edited into a replacement, merged or returned. The save would be refused
 * by the server anyway; this stops the user before they re-enter anything.
 */
export async function EditBlockedNotice({
  code,
  documentHref,
  replacementHref,
  message,
}: {
  code: string;
  documentHref: string;
  replacementHref?: string | null;
  /** Specific reason; defaults to the generic stale/cancelled message. */
  message?: string;
}) {
  const t = await getTranslations("editBlocked");
  return (
    <div className="min-h-full h-full grid place-items-center p-4 sm:p-6">
      <div role="alert" className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 text-center space-y-4">
        <p className="font-semibold">{t("title", { code })}</p>
        <p className="text-sm text-slate-500">{message ?? t("message")}</p>
        <div className="flex flex-wrap justify-center gap-2">
          <Link
            href={documentHref}
            className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-2 text-sm font-medium hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {t("viewDocument", { code })}
          </Link>
          {replacementHref && (
            <Link
              href={replacementHref}
              className="inline-flex items-center rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white hover:bg-primary-700"
            >
              {t("openReplacement")}
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
