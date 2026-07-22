import Link from "next/link";
import { ArrowLeft, FilePlus2 } from "lucide-react";
import { getCameraQuoteFormOptions } from "@/lib/data/camera-quotes";
import { Routes } from "@/lib/routes";
import { CameraQuoteBuilder } from "./camera-quote-builder";

export const dynamic = "force-dynamic";

export default async function NewCameraQuotePage() {
  const options = await getCameraQuoteFormOptions();

  return (
    <div className="p-4 sm:p-6">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <Link
            href={`${Routes.Sales}?tab=quotes`}
            className="mt-0.5 inline-flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-surface text-slate-500 hover:bg-surface-2 hover:text-slate-900"
            aria-label="Quay lại danh sách báo giá"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <FilePlus2 className="h-5 w-5 text-primary-600" />
              <h1 className="text-xl font-black text-slate-900 dark:text-slate-100">Tạo báo giá lắp đặt camera</h1>
            </div>
            <p className="mt-1 text-sm text-slate-500">
              Chọn camera và cấu hình trọn gói theo từng vị trí lắp đặt.
            </p>
          </div>
        </div>
        <div className="rounded-xl border border-primary-200 bg-primary-50 px-4 py-2.5 text-sm text-primary-800">
          <span className="font-bold">{options.cameras.length}</span> camera đã đồng bộ
        </div>
      </header>

      <CameraQuoteBuilder options={options} />
    </div>
  );
}
