import { Loader2, Printer } from "lucide-react";

export default function PrintOrderLoading() {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/45 p-0 backdrop-blur-[2px] sm:p-5">
      <section
        role="status"
        aria-live="polite"
        aria-label="Đang tạo bản xem trước để in"
        className="flex h-dvh w-full flex-col overflow-hidden bg-slate-200 shadow-2xl dark:bg-slate-950 sm:h-[min(94dvh,1100px)] sm:max-w-[1100px] sm:rounded-2xl"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-border bg-surface px-4 py-3 sm:px-5">
          <div className="h-8 w-44 animate-pulse rounded-lg bg-surface-2" />
          <div className="h-10 w-24 animate-pulse rounded-lg bg-surface-2" />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="grid size-12 place-items-center rounded-full bg-primary-50 text-primary-600">
            <Printer className="size-6" />
          </div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
            <Loader2 className="size-4 animate-spin" />
            Đang tạo bản xem trước…
          </div>
          <p className="max-w-sm text-xs text-slate-500">Đang tải thông tin đơn hàng và mẫu in.</p>
        </div>
      </section>
    </div>
  );
}
