"use client";

import { useMemo, useState } from "react";
import { Camera, Check, Copy, Edit3, MemoryStick, Search, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type CameraPackage = { id: string; cameraId: string; cardId: string; model: string; description: string; memory: string; price: number };

export function CameraPriceListClient({ packages: initialPackages, canEdit }: { packages: CameraPackage[]; canEdit: boolean }) {
  const [packages, setPackages] = useState(initialPackages);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<CameraPackage | null>(null);
  const [price, setPrice] = useState("");
  const [notice, setNotice] = useState("");
  const filtered = useMemo(() => packages.filter((item) => `${item.model} ${item.memory} ${item.description}`.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi"))), [packages, query]);

  function savePrice() {
    if (!editing) return;
    const value = Number(price.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(value) || value < 0) return setNotice("Giá chưa hợp lệ.");
    setPackages((current) => current.map((item) => item.id === editing.id ? { ...item, price: value } : item));
    setEditing(null); setNotice("Đã cập nhật giá tạm thời cho ảnh báo giá này.");
  }

  async function copyImage() {
    const canvas = document.createElement("canvas");
    canvas.width = 1500; canvas.height = Math.max(620, 260 + filtered.length * 104);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#f8fafc"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#12344d"; ctx.fillRect(0, 0, canvas.width, 185);
    ctx.fillStyle = "#ffffff"; ctx.font = "800 54px Arial"; ctx.fillText("BẢNG GIÁ LẮP ĐẶT CAMERA", 72, 84);
    ctx.font = "28px Arial"; ctx.fillText("Hải Đăng Tech · Giá đã gồm vật tư cơ bản và công lắp đặt", 72, 133);
    let y = 235;
    ctx.fillStyle = "#0f766e"; ctx.font = "700 24px Arial"; ctx.fillText("MODEL CAMERA", 72, y);
    ctx.fillText("GÓI THẺ NHỚ", 930, y); ctx.fillText("GIÁ TRỌN GÓI", 1185, y);
    y += 42;
    filtered.forEach((item, index) => {
      ctx.fillStyle = index % 2 ? "#f1f5f9" : "#ffffff"; ctx.fillRect(48, y - 28, 1404, 84);
      ctx.fillStyle = "#172554"; ctx.font = "700 27px Arial"; ctx.fillText(item.model.slice(0, 48), 72, y + 3);
      ctx.font = "22px Arial"; ctx.fillStyle = "#64748b"; ctx.fillText(item.memory.slice(0, 20), 930, y + 3);
      ctx.font = "800 26px Arial"; ctx.fillStyle = "#0f766e"; ctx.fillText(formatCurrency(item.price), 1185, y + 3);
      y += 104;
    });
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) return setNotice("Không tạo được ảnh báo giá.");
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNotice("Đã sao chép ảnh báo giá. Có thể dán vào Zalo/Messenger.");
    } else {
      const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "bao-gia-camera.png"; link.click(); URL.revokeObjectURL(link.href);
      setNotice("Trình duyệt đã tải ảnh báo giá xuống.");
    }
  }

  return <main className="min-h-full bg-canvas p-4 sm:p-6"><div className="mx-auto max-w-5xl">
    <header className="rounded-3xl bg-gradient-to-br from-primary-700 to-slate-900 px-6 py-7 text-white shadow-e2"><div className="flex items-start gap-4"><div className="grid h-12 w-12 place-items-center rounded-2xl bg-white/15"><Camera className="h-6 w-6" /></div><div><p className="text-xs font-black tracking-[.18em] text-white/70">BÁO GIÁ CHI TIẾT</p><h1 className="mt-1 text-2xl font-black sm:text-3xl">Lắp đặt camera</h1><p className="mt-2 text-sm text-white/80">{filtered.length} gói tham khảo · đã gồm vật tư và lắp đặt cơ bản</p></div></div></header>
    <div className="mt-4 flex flex-wrap items-center gap-3"><label className="relative min-w-[240px] flex-1"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm model camera..." className="w-full rounded-xl border border-border bg-surface py-2.5 pl-9 pr-3" /></label><button onClick={copyImage} className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-primary-600 px-4 text-sm font-bold text-white hover:bg-primary-700"><Copy className="h-4 w-4" />Sao chép ảnh</button></div>
    {notice && <p className="mt-3 text-sm font-medium text-primary-700">{notice}</p>}
    <section className="mt-4 overflow-hidden rounded-2xl border border-border bg-surface shadow-e1"><div className="hidden grid-cols-[1fr_180px_180px_44px] border-b border-border bg-surface-2 px-5 py-3 text-xs font-bold text-slate-500 md:grid"><span>MODEL CAMERA</span><span>GÓI THẺ NHỚ</span><span className="text-right">GIÁ TRỌN GÓI</span></div>{filtered.map((item) => <article key={item.id} className="grid gap-3 border-b border-border px-4 py-4 last:border-0 md:grid-cols-[1fr_180px_180px_44px] md:items-center"><div><div className="flex items-center gap-2 font-extrabold"><Camera className="h-4 w-4 text-primary-600" />{item.model}</div><p className="mt-1 text-xs text-slate-500">{item.description}</p></div><div className="flex items-center gap-2 text-sm font-semibold text-slate-600"><MemoryStick className="h-4 w-4 text-primary-600" />{item.memory}</div><div className="text-right text-base font-black text-primary-700">{formatCurrency(item.price)}</div>{canEdit && <button onClick={() => { setEditing(item); setPrice(String(item.price)); }} className="rounded-lg p-2 text-slate-500 hover:bg-surface-2 hover:text-primary-700" aria-label={`Sửa giá ${item.model}`}><Edit3 className="h-4 w-4" /></button>}</article>)}</section>
    <p className="mt-4 flex items-center gap-2 text-xs text-slate-500"><Check className="h-4 w-4 text-primary-600" />Giá có thể thay đổi theo vị trí thi công và vật tư phát sinh.</p>
  </div>{editing && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"><div className="w-full max-w-sm rounded-2xl bg-surface p-5 shadow-e2"><div className="flex items-center justify-between"><h2 className="font-black">Sửa giá tạm thời</h2><button onClick={() => setEditing(null)}><X className="h-5 w-5" /></button></div><p className="mt-2 text-sm text-slate-500">{editing.model} · {editing.memory}</p><input inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-4 w-full rounded-xl border border-border px-3 py-2.5 text-lg font-bold" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="rounded-lg px-3 py-2 text-sm font-semibold">Hủy</button><button onClick={savePrice} className="rounded-lg bg-primary-600 px-3 py-2 text-sm font-semibold text-white">Áp dụng</button></div></div></div>}</main>;
}
