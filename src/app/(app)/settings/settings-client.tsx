"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { Plus, Pencil, Check, Printer } from "lucide-react";
import { SearchableSelect } from "@/components/combobox";
import { Toggle } from "@/components/ui/toggle";
import { cn } from "@/lib/utils";

/* ── sample data (design preview — chưa nối backend) ── */
const STAFF = [
  { id: 1, name: "Nguyễn Thị Hoa", role: "owner", color: "#0C7B6B", phone: "0912 345 678", active: true, lastLogin: "14/06 06:00" },
  { id: 2, name: "Trần Văn Minh", role: "manager", color: "#1D4ED8", phone: "0923 456 789", active: true, lastLogin: "14/06 07:30" },
  { id: 3, name: "Phạm Thùy Linh", role: "cashier", color: "#B45309", phone: "0934 567 890", active: true, lastLogin: "14/06 09:00" },
  { id: 4, name: "Lê Thị Nga", role: "cashier", color: "#6B6F76", phone: "0945 678 901", active: false, lastLogin: "12/06 18:00" },
  { id: 5, name: "Lê Công Khoa", role: "accountant", color: "#9CA0A8", phone: "0956 789 012", active: true, lastLogin: "13/06 10:00" },
];
const ROLE_LABELS: Record<string, [string, string]> = {
  owner: ["Owner", "Chủ cửa hàng"], manager: ["Manager", "Quản lý"],
  cashier: ["Cashier", "Thu ngân"], stock: ["Stock-keeper", "Thủ kho"], accountant: ["Accountant", "Kế toán"],
};
const ROLE_BADGE: Record<string, string> = {
  owner: "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300",
  manager: "bg-in-soft text-in", cashier: "bg-ok-soft text-ok",
  stock: "bg-warn-soft text-warn", accountant: "bg-surface-2 text-slate-500",
};
const PERMS: { en: string; vi: string; roles: Record<string, boolean> }[] = [
  { en: "Process sales", vi: "Thực hiện bán hàng", roles: { owner: true, manager: true, cashier: true, stock: false, accountant: false } },
  { en: "Apply discount", vi: "Áp dụng giảm giá", roles: { owner: true, manager: true, cashier: true, stock: false, accountant: false } },
  { en: "Price override", vi: "Ghi đè giá bán", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: false } },
  { en: "Process refund", vi: "Thực hiện hoàn tiền", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: false } },
  { en: "Void / delete invoice", vi: "Hủy hóa đơn", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: false } },
  { en: "Add / edit products", vi: "Thêm / sửa sản phẩm", roles: { owner: true, manager: true, cashier: false, stock: true, accountant: false } },
  { en: "Stock inbound", vi: "Nhập kho", roles: { owner: true, manager: true, cashier: false, stock: true, accountant: false } },
  { en: "View reports", vi: "Xem báo cáo", roles: { owner: true, manager: true, cashier: false, stock: false, accountant: true } },
  { en: "Settings access", vi: "Truy cập cài đặt", roles: { owner: true, manager: false, cashier: false, stock: false, accountant: false } },
];
const DEVICES = [
  { ico: "🖨️", name: "XPrinter XP-N260L", en: "Thermal Printer 80mm", vi: "Máy in nhiệt 80mm", status: "connected", detail: "USB · COM3" },
  { ico: "📷", name: "Honeywell Voyager 1250g", en: "Barcode Scanner", vi: "Máy quét mã vạch", status: "connected", detail: "USB HID · Wedge" },
  { ico: "🗃️", name: "APG Vasario 1416", en: "Cash Drawer", vi: "Ngăn kéo tiền", status: "connected", detail: "Triggered via printer" },
  { ico: "⚖️", name: "CAS SW-1S", en: "Weighing Scale", vi: "Cân điện tử", status: "disconnected", detail: "COM4 · not responding" },
  { ico: "💳", name: "POS terminal / SoftPOS", en: "Card Reader / mPOS", vi: "Đầu đọc thẻ", status: "unconfigured", detail: "Configure in Payments" },
];
const PAYMENTS = [
  { ico: "💵", name: "Cash", vi: "Tiền mặt", id: "cash", enabled: true, color: "#15803D", note: "Always available · change calc built-in" },
  { ico: "📱", name: "VietQR / Napas", vi: "VietQR", id: "qr", enabled: true, color: "#1D4ED8", note: "Dynamic QR · auto-confirm · Napas" },
  { ico: "🟣", name: "MoMo", vi: "Ví MoMo", id: "momo", enabled: true, color: "#A50064", note: "Deep-link + webhook · timeout 90s" },
  { ico: "🔵", name: "ZaloPay", vi: "Ví ZaloPay", id: "zalopay", enabled: false, color: "#006AFF", note: "Not yet configured — tap to set up" },
  { ico: "🔴", name: "VNPay", vi: "VNPay", id: "vnpay", enabled: false, color: "#CC0000", note: "Not yet configured — tap to set up" },
  { ico: "💳", name: "Card / SoftPOS", vi: "Thẻ / mPOS", id: "card", enabled: false, color: "#374151", note: "Connect card reader in Hardware first" },
];
const VAT_RATES = [
  { rate: 0, en: "Exempt", vi: "Miễn thuế", itemsEn: "Exports, financial services", itemsVi: "Xuất khẩu, dịch vụ tài chính" },
  { rate: 5, en: "Reduced", vi: "Giảm thuế", itemsEn: "Essential food, medicine", itemsVi: "Thực phẩm thiết yếu, dược phẩm" },
  { rate: 8, en: "Standard reduced", vi: "Tiêu chuẩn giảm", itemsEn: "Most goods & services", itemsVi: "Hầu hết hàng hóa & dịch vụ" },
  { rate: 10, en: "Standard", vi: "Tiêu chuẩn", itemsEn: "Electronics, fashion, cosmetics", itemsVi: "Điện tử, thời trang, mỹ phẩm" },
];
const MIGRATION = [
  { ico: "🔵", name: "KiotViet", color: "#2563EB", desc: "Products, customers, history · .xlsx" },
  { ico: "🟢", name: "Sapo POS", color: "#16A34A", desc: "Full catalog, variants · API or .csv" },
  { ico: "🟣", name: "POS365", color: "#7C3AED", desc: "Products, stock, invoices · .xlsx" },
  { ico: "⬛", name: "Excel / CSV", color: "#374151", desc: "Universal import w/ column mapping" },
];

type SectionId = "store" | "staff" | "hardware" | "payments" | "print" | "tax" | "notifications" | "migration";

const NAV: { group: [string, string]; items: { id: SectionId; ico: string; en: string; vi: string; badge?: string }[] }[] = [
  { group: ["Store", "Cửa hàng"], items: [
    { id: "store", ico: "🏪", en: "Store Profile", vi: "Thông tin cửa hàng" },
    { id: "staff", ico: "👤", en: "Staff & RBAC", vi: "Nhân viên & Phân quyền" },
  ] },
  { group: ["Operations", "Vận hành"], items: [
    { id: "hardware", ico: "🖨️", en: "Hardware", vi: "Thiết bị phần cứng" },
    { id: "payments", ico: "💳", en: "Payments", vi: "Thanh toán" },
    { id: "print", ico: "📄", en: "Print Templates", vi: "Mẫu in", badge: "15.1" },
  ] },
  { group: ["Compliance", "Tuân thủ"], items: [
    { id: "tax", ico: "📋", en: "Tax & E-Invoice", vi: "Thuế & HĐ điện tử" },
  ] },
  { group: ["System", "Hệ thống"], items: [
    { id: "notifications", ico: "🔔", en: "Notifications", vi: "Thông báo" },
    { id: "migration", ico: "📦", en: "Data Migration", vi: "Di chuyển dữ liệu" },
  ] },
];
const SEC_META: Record<SectionId, { en: string; vi: string; subEn: string; subVi: string }> = {
  store: { en: "Store Profile", vi: "Thông tin cửa hàng", subEn: "Business identity, currency & locale", subVi: "Thông tin doanh nghiệp, tiền tệ & ngôn ngữ" },
  staff: { en: "Staff & RBAC", vi: "Nhân viên & Phân quyền", subEn: "Members and role-based access control", subVi: "Nhân viên và phân quyền theo vai trò" },
  hardware: { en: "Hardware Devices", vi: "Thiết bị phần cứng", subEn: "Printer, scanner, drawer, scale, reader", subVi: "Máy in, quét mã, ngăn kéo, cân, đọc thẻ" },
  payments: { en: "Payment Methods", vi: "Phương thức thanh toán", subEn: "Vietnamese payment ecosystem", subVi: "Hệ sinh thái thanh toán Việt Nam" },
  print: { en: "Print Templates", vi: "Mẫu in", subEn: "Receipt & document template designer", subVi: "Thiết kế mẫu hóa đơn & chứng từ" },
  tax: { en: "Tax & E-Invoice", vi: "Thuế & Hóa đơn điện tử", subEn: "VAT rates + Decree 70/2025 e-invoice", subVi: "Thuế GTGT + HĐĐT theo Nghị định 70/2025" },
  notifications: { en: "Notifications", vi: "Thông báo", subEn: "Alert types and channels", subVi: "Loại thông báo và kênh gửi" },
  migration: { en: "Data Migration", vi: "Di chuyển dữ liệu", subEn: "Import from other POS systems", subVi: "Nhập dữ liệu từ hệ thống POS khác" },
};

/* ── helpers (luma classes mapping prototype) ── */
function Card({ title, vi, action, children }: { title: string; vi: string; action?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-card shadow-e2 mb-4">
      <div className="px-4.5 py-3 border-b border-border bg-canvas rounded-t-card flex items-center justify-between gap-3">
        <div>
          <div className="text-xs font-bold">{title}</div>
          <div className="text-[10px] italic text-slate-400 mt-px">{vi}</div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}
const FL = "text-[9px] font-bold uppercase tracking-wide text-slate-500";
const FI = "w-full px-[11px] py-[9px] bg-canvas border-[1.5px] border-border rounded-[10px] text-[13px] outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/30";
const ROW = "flex items-center justify-between gap-3 px-3.5 py-2.5 bg-canvas rounded-[10px] border border-border";
const btnS = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-xs font-semibold hover:bg-surface-2 transition";
const btnF = "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary-600 text-white text-xs font-semibold hover:brightness-110 transition";

export function SettingsClient() {
  const locale = useLocale();
  const L = locale === "vi";
  const [active, setActive] = useState<SectionId>("store");
  useEffect(() => {
    const saved = localStorage.getItem("lp-settings-active") as SectionId | null;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time client sync of persisted section (SSR-safe)
    if (saved && SEC_META[saved]) setActive(saved);
  }, []);
  const pick = (id: SectionId) => { setActive(id); localStorage.setItem("lp-settings-active", id); };
  const sec = SEC_META[active];

  return (
    <div className="flex h-[calc(100vh)] lg:h-screen overflow-hidden">
      {/* settings nav */}
      <nav className="w-55 shrink-0 bg-surface border-r border-border overflow-y-auto hidden md:flex flex-col">
        <div className="px-4 py-3.5 border-b border-border">
          <div className="text-sm font-extrabold">{L ? "Cài đặt" : "Settings"}</div>
          <div className="text-[10px] italic text-slate-400 mt-0.5">{L ? "Cài đặt hệ thống" : "System settings"}</div>
        </div>
        {NAV.map((grp, gi) => (
          <div key={gi}>
            <div className="px-3 pt-2.5 pb-1 text-[9px] font-bold uppercase tracking-[0.07em] text-slate-400">{L ? grp.group[1] : grp.group[0]}</div>
            {grp.items.map((it) => (
              <button
                key={it.id}
                onClick={() => pick(it.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3.5 py-2 text-xs font-semibold border-l-2 transition",
                  active === it.id
                    ? "bg-primary-50 dark:bg-primary-950/40 text-primary-700 dark:text-primary-300 border-primary-600"
                    : "text-slate-500 border-transparent hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-200"
                )}
              >
                <span className="w-4.5 text-center text-sm shrink-0">{it.ico}</span>
                <span className="flex-1 text-left">{L ? it.vi : it.en}</span>
                {it.badge && <span className="text-[8px] bg-in-soft text-in border border-in/30 rounded-full px-1.5 py-px">{it.badge}</span>}
              </button>
            ))}
          </div>
        ))}
      </nav>

      {/* content */}
      <div className="flex-1 overflow-y-auto px-5 md:px-7 py-6 pb-12">
        {/* mobile section picker */}
        <div className="md:hidden mb-4">
          <select value={active} onChange={(e) => pick(e.target.value as SectionId)} className={FI}>
            {NAV.flatMap((g) => g.items).map((it) => <option key={it.id} value={it.id}>{L ? it.vi : it.en}</option>)}
          </select>
        </div>

        <div className="text-[10px] font-bold uppercase tracking-[0.07em] text-primary-600 mb-1.5">SETTINGS · {active.toUpperCase()}</div>
        <h1 className="text-xl font-extrabold tracking-tight">{L ? sec.vi : sec.en}</h1>
        <div className="text-xs italic text-slate-400 mt-0.5">{L ? sec.subVi : sec.subEn}</div>
        <div className="w-9 h-0.75 bg-primary-600 rounded mt-3 mb-5" />

        {active === "store" && <StoreSection L={L} locale={locale} />}
        {active === "staff" && <StaffSection L={L} />}
        {active === "hardware" && <HardwareSection L={L} />}
        {active === "payments" && <PaymentsSection L={L} />}
        {active === "print" && <PrintSection L={L} />}
        {active === "tax" && <TaxSection L={L} locale={locale} />}
        {active === "notifications" && <NotificationsSection L={L} />}
        {active === "migration" && <MigrationSection L={L} />}
      </div>
    </div>
  );
}

function StoreSection({ L, locale }: { L: boolean; locale: string }) {
  const [industry, setIndustry] = useState("grocery");
  const [currency, setCurrency] = useState("VND");
  const industryOpts = [
    ["grocery", "Grocery / Mini-mart", "Tạp hóa / Siêu thị mini"], ["cafe", "Café", "Quán cà phê"],
    ["restaurant", "Restaurant", "Nhà hàng"], ["fashion", "Fashion & Apparel", "Thời trang"],
    ["electronics", "Electronics", "Điện tử / Điện máy"], ["cosmetics", "Cosmetics & Beauty", "Mỹ phẩm"],
    ["books", "Books & Stationery", "Sách & VPP"], ["services", "Service Business", "Dịch vụ"],
    ["petshop", "Pet Shop", "Thú cưng"], ["mobile", "Mobile & Gadgets", "Điện thoại & Phụ kiện"],
    ["construction", "Construction Materials", "Vật liệu xây dựng"],
  ].map(([value, en, vi]) => ({ value, label: locale === "vi" ? vi : en }));
  const currencyOpts = [{ value: "VND", label: "VND — Việt Nam Đồng (₫)" }, { value: "USD", label: "USD — US Dollar ($)" }];
  return (
    <Card title={L ? "Thông tin cửa hàng" : "Store Profile"} vi={L ? "Store Profile" : "Thông tin cửa hàng"}>
      <div className="p-4.5 flex flex-col gap-3">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Tên cửa hàng" : "Store Name"}</span><input className={FI} defaultValue="Cửa hàng Nguyễn Hoa" /></div>
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Số điện thoại" : "Phone"}</span><input className={FI} defaultValue="0912 345 678" /></div>
        </div>
        <div className="flex flex-col gap-1"><span className={FL}>{L ? "Địa chỉ" : "Address"}</span><input className={FI} defaultValue="Số 12 Nguyễn Trãi, Cầu Giấy, Hà Nội" /></div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Ngành" : "Industry"}</span>
            <SearchableSelect options={industryOpts} value={industry} onChange={setIndustry} allowClear={false} />
          </div>
          <div className="flex flex-col gap-1"><span className={FL}>{L ? "Tiền tệ" : "Currency"}</span>
            <SearchableSelect options={currencyOpts} value={currency} onChange={setCurrency} allowClear={false} />
          </div>
        </div>
      </div>
    </Card>
  );
}

function StaffSection({ L }: { L: boolean }) {
  const [tab, setTab] = useState<"list" | "perms">("list");
  const roles = ["owner", "manager", "cashier", "stock", "accountant"];
  return (
    <>
      <div className="inline-flex bg-canvas border border-border rounded-[10px] p-0.75 gap-0.5 mb-3.5">
        {([["list", L ? "Danh sách NV" : "Staff List"], ["perms", L ? "Phân quyền" : "Permission Matrix"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("px-3.5 py-1.5 rounded-[7px] text-[11px] font-bold transition", tab === k ? "bg-surface shadow-e1" : "text-slate-500")}>{lbl}</button>
        ))}
      </div>
      {tab === "list" && (
        <Card title={L ? "Danh sách nhân viên" : "Staff Members"} vi={L ? "Staff Members — RBAC" : "Nhân viên — phân quyền"} action={<button className={btnF}><Plus className="w-3 h-3" />{L ? "Thêm NV" : "Add Staff"}</button>}>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-canvas text-left text-[9px] uppercase tracking-wide text-slate-400 border-b border-border">
                <th className="px-3 py-2 font-bold">{L ? "Nhân viên" : "Staff"}</th>
                <th className="px-3 py-2 font-bold">{L ? "Vai trò" : "Role"}</th>
                <th className="px-3 py-2 font-bold">{L ? "Điện thoại" : "Phone"}</th>
                <th className="px-3 py-2 font-bold">PIN</th>
                <th className="px-3 py-2 font-bold">{L ? "Trạng thái" : "Status"}</th>
                <th className="px-3 py-2 font-bold">{L ? "Đăng nhập" : "Last login"}</th>
                <th />
              </tr></thead>
              <tbody>{STAFF.map((s) => (
                <tr key={s.id} className="border-b border-border-soft last:border-0 hover:bg-surface-2">
                  <td className="px-3 py-2.5"><div className="flex items-center gap-2">
                    <span className="w-7 h-7 rounded-full grid place-items-center text-[11px] font-extrabold text-white shrink-0" style={{ background: s.color }}>{s.name.split(" ").pop()![0]}</span>
                    <span className="font-bold text-xs">{s.name}</span>
                  </div></td>
                  <td className="px-3 py-2.5"><span className={cn("inline-block px-2 py-0.5 rounded-full text-[9px] font-bold", ROLE_BADGE[s.role])}>{L ? ROLE_LABELS[s.role][1] : ROLE_LABELS[s.role][0]}</span></td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-500">{s.phone}</td>
                  <td className="px-3 py-2.5 font-mono text-slate-400 tracking-widest">••••</td>
                  <td className="px-3 py-2.5">{s.active ? <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold bg-ok-soft text-ok">{L ? "Hoạt động" : "Active"}</span> : <span className="inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold bg-surface-2 text-slate-400">{L ? "Vô hiệu" : "Inactive"}</span>}</td>
                  <td className="px-3 py-2.5 font-mono text-[11px] text-slate-400">{s.lastLogin}</td>
                  <td className="px-3 py-2.5"><button className={btnS}><Pencil className="w-3 h-3" /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </Card>
      )}
      {tab === "perms" && (
        <Card title={L ? "Ma trận phân quyền" : "Permission Matrix"} vi={L ? "RBAC" : "Phân quyền theo vai trò (RBAC)"}>
          <div className="overflow-x-auto">
            <table className="w-full text-[11px]">
              <thead><tr className="bg-canvas border-b border-border text-[9px] uppercase tracking-wide text-slate-400">
                <th className="px-2 py-2 text-left font-bold min-w-45">{L ? "Hành động" : "Action"}</th>
                {roles.map((r) => <th key={r} className="px-2 py-2 font-bold text-center">{L ? ROLE_LABELS[r][1] : ROLE_LABELS[r][0]}</th>)}
              </tr></thead>
              <tbody>{PERMS.map((p, i) => (
                <tr key={i} className="border-b border-border-soft last:border-0">
                  <td className="px-2 py-2 font-semibold text-slate-900 dark:text-slate-100">{L ? p.vi : p.en}</td>
                  {roles.map((r) => <td key={r} className="px-2 py-2 text-center">{p.roles[r] ? <Check className="w-3.5 h-3.5 text-ok inline" /> : <span className="text-slate-300 dark:text-slate-700">✕</span>}</td>)}
                </tr>
              ))}</tbody>
            </table>
          </div>
          <div className="px-3.5 py-2.5 bg-in-soft border-t border-in/20 text-[10px] text-in">
            {L ? "RBAC mặc định — Owner có thể tùy chỉnh từng quyền (bản Enterprise)." : "Default RBAC — Owner can customise individual permissions (Enterprise plan)."}
          </div>
        </Card>
      )}
    </>
  );
}

function HardwareSection({ L }: { L: boolean }) {
  const dot = { connected: "bg-ok", disconnected: "bg-er", unconfigured: "bg-slate-400" } as const;
  const lbl = { connected: [L ? "Đã kết nối" : "Connected", "text-ok"], disconnected: [L ? "Mất kết nối" : "Disconnected", "text-er"], unconfigured: [L ? "Chưa cấu hình" : "Not configured", "text-slate-400"] } as const;
  return (
    <>
      <Card title={L ? "Thiết bị phần cứng" : "Hardware Devices"} vi={L ? "Máy in · Quét mã · Ngăn kéo · Cân · Đọc thẻ" : "Printer · Scanner · Drawer · Scale · Reader"} action={<button className={btnS}>{L ? "Thêm thiết bị" : "Add Device"}</button>}>
        <div className="p-4 flex flex-col gap-2">
          {DEVICES.map((d, i) => (
            <div key={i} className={ROW}>
              <span className="w-9 h-9 rounded-[10px] bg-surface-2 grid place-items-center text-lg shrink-0">{d.ico}</span>
              <div className="flex-1 min-w-0">
                <div className="text-xs font-bold truncate">{d.name}</div>
                <div className="text-[10px] text-slate-500">{(L ? d.vi : d.en)} · {d.detail}</div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn("w-2 h-2 rounded-full", dot[d.status as keyof typeof dot])} />
                <span className={cn("text-[10px] font-bold", lbl[d.status as keyof typeof lbl][1])}>{lbl[d.status as keyof typeof lbl][0]}</span>
                <button className={btnS}>{d.status === "connected" ? (L ? "Kiểm tra" : "Test") : d.status === "disconnected" ? (L ? "Kết nối lại" : "Reconnect") : (L ? "Cấu hình" : "Configure")}</button>
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Card title={L ? "Mẫu in nhanh" : "Quick Print Settings"} vi={L ? "Vào Mẫu in để tùy chỉnh đầy đủ" : "Open Print Templates for full control"} action={<Link href="/settings/print" className={btnF}><Printer className="w-3 h-3" />{L ? "Mở thiết kế mẫu in →" : "Open designer →"}</Link>}>
        <div className="p-4.5 flex flex-col gap-1.5">
          <ToggleRow on title={L ? "In QR hóa đơn điện tử" : "Print e-invoice QR"} desc={L ? "Mã xác thực theo Nghị định 70" : "Decree 70 verification code"} />
          <ToggleRow on title={L ? "In tự động sau mỗi đơn" : "Auto-print after each order"} />
          <ToggleRow on title={L ? "Mở ngăn kéo khi thu tiền mặt" : "Open cash drawer on cash payment"} />
        </div>
      </Card>
    </>
  );
}

function PaymentsSection({ L }: { L: boolean }) {
  const [pm, setPm] = useState(PAYMENTS);
  const toggle = (id: string) => setPm((p) => p.map((x) => x.id === id ? { ...x, enabled: !x.enabled } : x));
  return (
    <>
      <Card title={L ? "Phương thức thanh toán" : "Payment Methods"} vi={L ? "Hệ sinh thái thanh toán VN" : "Vietnamese payment ecosystem"}>
        <div className="p-4 flex flex-col gap-2">
          {pm.map((p) => (
            <div key={p.id} className={ROW}>
              <span className="w-9 h-9 rounded-[10px] grid place-items-center text-lg shrink-0" style={{ background: p.color + "22", border: `1px solid ${p.color}33` }}>{p.ico}</span>
              <div className="flex-1 min-w-0"><div className="text-xs font-bold">{L ? p.vi : p.name}</div><div className="text-[10px] text-slate-500">{p.note}</div></div>
              <Toggle checked={p.enabled} onChange={() => toggle(p.id)} aria-label={p.name} />
              {p.enabled && p.id !== "cash" && <button className={btnS}>{L ? "Cấu hình" : "Configure"}</button>}
            </div>
          ))}
        </div>
      </Card>
      <Card title={L ? "Thanh toán chia đôi" : "Split Payment"} vi={L ? "Một hóa đơn nhiều phương thức" : "Multiple methods per invoice"} action={<Toggle checked onChange={() => {}} aria-label="split" />}>
        <div className="p-4.5 text-[11px] text-slate-500 leading-relaxed">{L ? "Khách có thể thanh toán một hóa đơn bằng nhiều phương thức (vd: một phần tiền mặt, còn lại VietQR). Bật tại màn thanh toán POS." : "Customers can pay one invoice with a combination of methods (e.g. partial cash + VietQR). Enabled at POS checkout."}</div>
      </Card>
    </>
  );
}

function PrintSection({ L }: { L: boolean }) {
  return (
    <Card title={L ? "Thiết kế mẫu in (15.1)" : "Print Template Designer (15.1)"} vi={L ? "Hóa đơn · phiếu nhập · báo giá · K80/K57/A5/A4" : "Invoice · receipt · quotation · K80/K57/A5/A4"} action={<Link href="/settings/print" className={btnF}><Printer className="w-3 h-3" />{L ? "Mở thiết kế →" : "Open designer →"}</Link>}>
      <div className="p-4.5 text-[12px] text-slate-500 leading-relaxed">
        {L ? "Tùy chỉnh đầy đủ mẫu in theo loại phiếu và khổ giấy với xem trước trực tiếp." : "Full per-document, per-paper-size template customization with live preview."}
      </div>
    </Card>
  );
}

function TaxSection({ L, locale }: { L: boolean; locale: string }) {
  const [provider, setProvider] = useState("VNPT");
  const providerOpts = ["VNPT e-Invoice", "Viettel-S", "MISA meInvoice", "FPT Invoice", "Bkav eHóa đơn", "CyberLotus", "EasyInvoice"]
    .map((p) => ({ value: p.split(" ")[0], label: p }));
  const pctColor = (r: number) => r === 0 ? "text-slate-400" : r === 5 ? "text-ok" : r === 8 ? "text-warn" : "text-er";
  void locale;
  return (
    <>
      <Card title={L ? "Thuế GTGT — Bảng thuế suất" : "VAT Rate Table"} vi={L ? "Theo danh mục sản phẩm" : "Per product category"}>
        <div className="p-3.5 flex flex-col gap-1.5">
          {VAT_RATES.map((v, i) => (
            <div key={i} className={ROW}>
              <span className={cn("font-mono text-base font-extrabold w-10 shrink-0", pctColor(v.rate))}>{v.rate}%</span>
              <div className="flex-1 min-w-0"><div className="text-xs font-bold">{L ? v.vi : v.en}</div><div className="text-[10px] text-slate-500">{L ? v.itemsVi : v.itemsEn}</div></div>
              <span className="inline-flex rounded-full px-2 py-0.5 text-[9px] font-bold bg-ok-soft text-ok shrink-0">{L ? "Đang dùng" : "Active"}</span>
            </div>
          ))}
        </div>
      </Card>
      <Card title={L ? "Hóa đơn điện tử (Nghị định 70/2025)" : "E-Invoice — Decree 70/2025"} vi={L ? "HĐĐT — hàng đợi khi offline" : "Offline queue support"} action={<Toggle checked onChange={() => {}} aria-label="einvoice" />}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="flex flex-col gap-1"><span className={FL}>{L ? "Mã số thuế (MST)" : "Tax ID (MST)"}</span><input className={cn(FI, "font-mono")} defaultValue="0123456789" /></div>
            <div className="flex flex-col gap-1"><span className={FL}>{L ? "Nhà cung cấp HĐĐT" : "E-Invoice Provider"}</span>
              <SearchableSelect options={providerOpts} value={provider} onChange={setProvider} allowClear={false} />
            </div>
          </div>
          <ToggleRow on title={L ? "Hàng đợi khi offline" : "Queue when offline"} desc={L ? "Tự gửi khi có mạng — chống trùng bằng idempotency key" : "Auto-send on reconnect — idempotency prevents dupes"} />
          <div className="px-3.5 py-2.5 bg-in-soft border border-in/20 rounded-[10px] text-[11px] text-in leading-relaxed">
            <strong>Circular 32/2025:</strong> {L ? "Mã xác thực cơ quan thuế bắt buộc trên mọi hóa đơn từ 01/07/2025." : "Tax-authority verification code mandatory on all invoices from 01/07/2025."}
          </div>
          <div className="flex gap-2"><button className={btnS}>{L ? "Kiểm tra kết nối" : "Test Connection"}</button><button className={btnF}><Check className="w-3 h-3" />{L ? "Lưu cấu hình" : "Save Config"}</button></div>
        </div>
      </Card>
    </>
  );
}

function NotificationsSection({ L }: { L: boolean }) {
  const types: [string, string, string][] = [
    [L ? "Cảnh báo tồn kho thấp" : "Low-stock alert", L ? "Khi tồn < mức tối thiểu" : "When stock < minimum", "1"],
    [L ? "Hàng chậm bán (>60 ngày)" : "Stagnant stock (>60 days)", L ? "SKU không bán 60 ngày" : "SKU unsold 60+ days", "1"],
    [L ? "Nhắc đóng ca (18:00)" : "Shift close reminder (18:00)", L ? "Nhắc đóng ca mỗi ngày" : "Daily shift close reminder", "1"],
    [L ? "Lỗi hóa đơn điện tử" : "E-invoice error", L ? "Khi HĐĐT gửi thất bại" : "When e-invoice fails", "1"],
    [L ? "Đồng bộ hoàn tất" : "Sync completed", L ? "Khi dữ liệu offline đồng bộ xong" : "When offline data syncs", "0"],
  ];
  const channels: [string, string, boolean][] = [["📱", "Zalo OA", true], ["📧", "Email", true], ["🔔", L ? "Thông báo trong ứng dụng" : "In-app push", true], ["💬", "SMS", false]];
  return (
    <>
      <Card title={L ? "Loại thông báo" : "Notification Types"} vi={L ? "Ngưỡng & sự kiện" : "Thresholds & events"}>
        <div className="p-4.5 flex flex-col gap-1.5">
          {types.map(([title, desc, on], i) => <ToggleRow key={i} on={on === "1"} title={title} desc={desc} />)}
        </div>
      </Card>
      <Card title={L ? "Kênh thông báo" : "Notification Channels"} vi={L ? "Nơi gửi thông báo" : "Where alerts are sent"}>
        <div className="p-3.5 flex flex-col gap-1.5">
          {channels.map(([ico, name, on], i) => (
            <div key={i} className={ROW}>
              <span className="text-lg">{ico}</span>
              <div className="flex-1 text-xs font-bold">{name}</div>
              <Toggle checked={on} onChange={() => {}} aria-label={name} />
              <button className={btnS}>{L ? "Cấu hình" : "Configure"}</button>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

function MigrationSection({ L }: { L: boolean }) {
  return (
    <>
      <div className="px-3.5 py-3 bg-in-soft border border-in/20 rounded-card text-[11px] text-in leading-relaxed mb-3.5">
        <strong>{L ? "Di chuyển dữ liệu từ hệ thống khác:" : "Migrate from another system:"}</strong>{" "}
        {L ? "Hỗ trợ KiotViet, Sapo, POS365 và Excel/CSV. Luôn chạy thử (dry-run) trước khi xác nhận — không mất dữ liệu." : "Imports from KiotViet, Sapo, POS365, Excel/CSV. Always dry-run preview first — no data changed until you confirm."}
      </div>
      <Card title={L ? "Chọn nguồn dữ liệu" : "Choose Migration Source"} vi={L ? "Nguồn để di chuyển" : "Source to import from"}>
        <div className="p-4 flex flex-col gap-2">
          {MIGRATION.map((s, i) => (
            <div key={i} className={ROW}>
              <span className="w-9 h-9 rounded-[10px] grid place-items-center text-base shrink-0" style={{ background: s.color + "22", border: `1px solid ${s.color}33` }}>{s.ico}</span>
              <div className="flex-1 min-w-0"><div className="text-xs font-bold">{s.name}</div><div className="text-[10px] text-slate-500">{s.desc}</div></div>
              <button className={btnS}>{L ? "Nhập →" : "Import →"}</button>
            </div>
          ))}
        </div>
      </Card>
      <Card title={L ? "Phiên bản schema — Quản lý dữ liệu" : "Schema Version — Data Management"} vi={L ? "Migration chỉ thêm, không xóa trường" : "Additive-only migrations"}>
        <div className="p-4.5 flex flex-col gap-3">
          <div className="grid grid-cols-3 gap-2.5">
            {[[L ? "Schema hiện tại" : "Current schema", "v6", "text-primary-600"], [L ? "Sản phẩm" : "Products", "248", ""], [L ? "Giao dịch" : "Transactions", "12.843", ""]].map(([l, v, c], i) => (
              <div key={i} className="px-3 py-2.5 bg-canvas border border-border rounded-[10px]">
                <div className="text-[9px] font-bold uppercase tracking-wide text-slate-400">{l}</div>
                <div className={cn("font-mono text-base font-extrabold mt-1", c)}>{v}</div>
              </div>
            ))}
          </div>
          <div className="flex gap-2"><button className={btnS}>{L ? "Xuất toàn bộ dữ liệu" : "Export all data"}</button><button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-er text-white text-xs font-semibold opacity-70">{L ? "Xóa tất cả dữ liệu" : "Delete all data"}</button></div>
        </div>
      </Card>
    </>
  );
}

function ToggleRow({ on, title, desc }: { on: boolean; title: string; desc?: string }) {
  const [v, setV] = useState(on);
  return (
    <div className={ROW}>
      <div className="flex-1 mr-3">
        <div className="text-xs font-bold">{title}</div>
        {desc && <div className="text-[10px] italic text-slate-500 mt-px">{desc}</div>}
      </div>
      <Toggle checked={v} onChange={setV} aria-label={title} />
    </div>
  );
}
