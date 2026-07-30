"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { ArrowLeft, ArrowRight, Check, Loader2 } from "lucide-react";
import { SearchableSelect } from "@/components/combobox";
import { completeOnboarding } from "@/lib/actions/onboarding";
import type { StoreSettings } from "@/lib/data/settings";
import { cn } from "@/lib/utils";

const INDUSTRY = [
  ["grocery", "Grocery / Mini-mart", "Tạp hóa / Siêu thị mini"], ["cafe", "Café", "Quán cà phê"],
  ["restaurant", "Restaurant", "Nhà hàng"], ["fashion", "Fashion & Apparel", "Thời trang"],
  ["electronics", "Electronics", "Điện tử / Điện máy"], ["cosmetics", "Cosmetics & Beauty", "Mỹ phẩm"],
  ["books", "Books & Stationery", "Sách & VPP"], ["services", "Service Business", "Dịch vụ"],
  ["petshop", "Pet Shop", "Thú cưng"], ["mobile", "Mobile & Gadgets", "Điện thoại & Phụ kiện"],
  ["construction", "Construction Materials", "Vật liệu xây dựng"],
] as const;
const FI = "w-full px-3 py-2.5 text-sm rounded-[10px] border border-border bg-canvas focus:border-primary-500 focus:outline-none";
const FL = "text-[10px] font-bold uppercase tracking-wide text-slate-500";

export function OnboardingWizard({ initial }: { initial: StoreSettings }) {
  const locale = useLocale();
  const L = locale === "vi";
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [err, setErr] = useState("");
  const [f, setF] = useState({ name: initial.name, phone: initial.phone, address: initial.address, industry: initial.industry || "grocery", currency: initial.currency || "VND", locale: initial.locale || "vi-VN" });
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const industryOpts = INDUSTRY.map(([value, en, vi]) => ({ value, label: L ? vi : en }));
  const currencyOpts = [{ value: "VND", label: "VND — Việt Nam Đồng (₫)" }, { value: "USD", label: "USD — US Dollar ($)" }];
  const localeOpts = [{ value: "vi-VN", label: "Tiếng Việt" }, { value: "en-US", label: "English" }];
  const steps = [L ? "Cửa hàng" : "Store", L ? "Ngành nghề" : "Business", L ? "Hoàn tất" : "Finish"];

  function finish() {
    setErr("");
    start(async () => {
      const res = await completeOnboarding(f);
      if (res.ok) router.push("/dashboard");
      else setErr(res.error);
    });
  }

  return (
    <div className="w-full max-w-lg bg-surface border border-border rounded-card shadow-e2 overflow-hidden">
      <div className="px-6 pt-6 pb-4 border-b border-border">
        <div className="flex items-center gap-2.5 mb-3">
          <div className="w-9 h-9 rounded-xl grid place-items-center text-white font-extrabold bg-gradient-to-br from-primary-600 to-primary-400">H</div>
          <div className="font-bold text-lg">Hải Đăng</div>
        </div>
        <div className="text-xl font-extrabold">{L ? "Thiết lập cửa hàng" : "Set up your store"}</div>
        <div className="text-xs text-slate-500 mt-0.5">{L ? "Vài bước nhanh để bắt đầu bán hàng." : "A few quick steps to start selling."}</div>
        <div className="flex items-center gap-2 mt-4">
          {steps.map((s, i) => (
            <div key={i} className="flex items-center gap-2 flex-1">
              <span className={cn("w-6 h-6 rounded-full grid place-items-center text-[11px] font-bold shrink-0", i < step ? "bg-primary-600 text-white" : i === step ? "bg-primary-600 text-white" : "bg-surface-2 text-slate-400")}>{i < step ? <Check className="w-3.5 h-3.5" /> : i + 1}</span>
              <span className={cn("text-[11px] font-semibold truncate", i === step ? "text-slate-900 dark:text-slate-100" : "text-slate-400")}>{s}</span>
              {i < steps.length - 1 && <span className="flex-1 h-px bg-border" />}
            </div>
          ))}
        </div>
      </div>

      <div className="p-6 flex flex-col gap-3">
        {step === 0 && <>
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Tên cửa hàng" : "Store name"}</span><input className={FI} value={f.name} onChange={(e) => set("name", e.target.value)} placeholder={L ? "Cửa hàng của bạn" : "Your store"} /></div>
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Số điện thoại" : "Phone"}</span><input className={FI} value={f.phone} onChange={(e) => set("phone", e.target.value)} /></div>
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Địa chỉ" : "Address"}</span><input className={FI} value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
        </>}
        {step === 1 && <>
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Ngành" : "Industry"}</span><SearchableSelect options={industryOpts} value={f.industry} onChange={(v) => set("industry", v)} allowClear={false} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1"><span className={FL}>{L ? "Tiền tệ" : "Currency"}</span><SearchableSelect options={currencyOpts} value={f.currency} onChange={(v) => set("currency", v)} allowClear={false} /></div>
            <div className="flex flex-col gap-1"><span className={FL}>{L ? "Ngôn ngữ" : "Locale"}</span><SearchableSelect options={localeOpts} value={f.locale} onChange={(v) => set("locale", v)} allowClear={false} /></div>
          </div>
        </>}
        {step === 2 && <div className="flex flex-col gap-2 text-sm">
          <div className="text-xs text-slate-500">{L ? "Xác nhận thông tin:" : "Confirm details:"}</div>
          {[[L ? "Tên" : "Name", f.name || "—"], [L ? "Điện thoại" : "Phone", f.phone || "—"], [L ? "Địa chỉ" : "Address", f.address || "—"], [L ? "Ngành" : "Industry", industryOpts.find((o) => o.value === f.industry)?.label ?? f.industry], [L ? "Tiền tệ" : "Currency", f.currency]].map(([k, v], i) => (
            <div key={i} className="flex justify-between gap-3 px-3 py-2 bg-canvas border border-border rounded-[10px]"><span className="text-slate-500">{k}</span><span className="font-semibold text-right truncate">{v}</span></div>
          ))}
        </div>}
        {err && <p className="text-xs text-er">{L ? "Có lỗi, thử lại." : "Something went wrong."}</p>}
      </div>

      <div className="px-6 pb-6 flex items-center gap-2">
        {step > 0 && <button onClick={() => setStep((s) => s - 1)} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-border text-sm font-semibold hover:bg-surface-2"><ArrowLeft className="w-4 h-4" />{L ? "Quay lại" : "Back"}</button>}
        <div className="flex-1" />
        {step < 2
          ? <button onClick={() => setStep((s) => s + 1)} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-primary-600 text-white text-sm font-semibold">{L ? "Tiếp" : "Next"}<ArrowRight className="w-4 h-4" /></button>
          : <button disabled={pending} onClick={finish} className="inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-primary-600 text-white text-sm font-semibold disabled:opacity-50">{pending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{L ? "Vào Dashboard" : "Go to Dashboard"}</button>}
      </div>
    </div>
  );
}
