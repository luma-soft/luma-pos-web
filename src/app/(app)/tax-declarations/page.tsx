import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { MobileTopBar } from "@/components/mobile-ui";
import { Text } from "@/components/ui/text";
import { requireStoreRole } from "@/lib/auth/store-context";
import { getAccountingAuxiliaryBooks } from "@/lib/data/accounting";
import { getRawStorePrefs } from "@/lib/data/settings";
import { Routes } from "@/lib/routes";
import { TaxDeclarationsClient } from "./tax-declarations-client";

export const dynamic = "force-dynamic";

export default async function TaxDeclarationsPage() {
  const context = await requireStoreRole(["owner", "manager"]); const prefs = await getRawStorePrefs(context.storeId);
  const now = new Date(); const data = await getAccountingAuxiliaryBooks(context.storeId, new Date(now.getFullYear(), 0, 1), new Date(now.getFullYear() + 1, 0, 1));
  const unconfigured = prefs.tax.calculationMethod === "unconfigured" || prefs.tax.filingFrequency === "unconfigured";
  return <div className="min-h-full bg-canvas"><MobileTopBar title="Kê khai thuế" subtitle={`Năm ${now.getFullYear()}`} /><header className="hidden min-h-[64px] items-center border-b border-border bg-surface px-6 lg:flex"><Text as="h1" weight="bold" className="text-2xl" text="Kê khai thuế" /></header><main className="p-3 sm:p-5 lg:p-6">{unconfigured ? <div className="mb-5 flex items-start gap-3 rounded-xl border border-warn/30 bg-warn/5 p-4 text-sm"><AlertTriangle className="h-5 w-5 shrink-0 text-warn" /><div><div className="font-bold">Chưa đủ cấu hình để lập tờ khai</div><p className="mt-1 text-slate-500">Hãy chọn phương pháp tính thuế và kỳ kê khai trước.</p><Link className="mt-2 inline-block font-bold text-primary-700 hover:underline" href={`${Routes.Settings}?tab=tax`}>Mở cài đặt thuế</Link></div></div> : null}<TaxDeclarationsClient declarations={data.declarations} bankAccounts={data.bankAccounts} filingFrequency={prefs.tax.filingFrequency} /></main></div>;
}
