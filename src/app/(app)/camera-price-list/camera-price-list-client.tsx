"use client";

import { useMemo, useState } from "react";
import { Copy, Edit3, Search, X } from "lucide-react";
import { formatCurrency } from "@/lib/utils";

type Variant = { id: string; cameraId: string; cardId: string; price: number };
type Model = { id: string; model: string; description: string; variants: Variant[] };

export function CameraPriceListClient({ models: initialModels, memoryLabels, canEdit }: { models: Model[]; memoryLabels: string[]; canEdit: boolean }) {
  const [models, setModels] = useState(initialModels);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{ model: Model; variant: Variant; label: string } | null>(null);
  const [price, setPrice] = useState("");
  const [notice, setNotice] = useState("");
  const filtered = useMemo(() => models.filter((item) => `${item.model} ${item.description}`.toLocaleLowerCase("vi").includes(query.toLocaleLowerCase("vi"))), [models, query]);

  function applyPrice() {
    if (!editing) return;
    const value = Number(price.replace(/[^0-9.]/g, ""));
    if (!Number.isFinite(value) || value < 0) return setNotice("Giá chưa hợp lệ.");
    setModels((current) => current.map((model) => model.id !== editing.model.id ? model : { ...model, variants: model.variants.map((variant) => variant.id === editing.variant.id ? { ...variant, price: value } : variant) }));
    setEditing(null); setNotice("Đã áp dụng giá tạm thời cho ảnh báo giá.");
  }

  async function copyImage(item: Model, index: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 1500; canvas.height = 510;
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#0d334d"; ctx.fillRect(0, 0, canvas.width, 34);
    ctx.fillStyle = "#0d887f"; ctx.fillRect(0, 0, 300, 34);
    ctx.fillStyle = "#14344d"; ctx.font = "800 50px Arial"; ctx.fillText("BẢNG GIÁ CHI TIẾT", 72, 115); ctx.fillText("LẮP ĐẶT CAMERA", 72, 174);
    ctx.fillStyle = "#14344d"; ctx.fillRect(72, 205, 1356, 64);
    ctx.fillStyle = "#ffffff"; ctx.font = "800 25px Arial"; ctx.fillText("HẢI ĐĂNG TECH", 94, 246); ctx.textAlign = "right"; ctx.fillText("0868306286 - 0868506286", 1404, 246); ctx.textAlign = "left";
    let y = 315;
    ctx.fillStyle = "#0b7b74"; ctx.fillRect(72, y, 1356, 46);
    ctx.fillStyle = "#ffffff"; ctx.font = "700 18px Arial"; ctx.fillText("STT", 94, y + 29); ctx.fillText("MODEL CAMERA", 175, y + 29); ctx.fillText("VỊ TRÍ PHÙ HỢP", 670, y + 29); ctx.fillText(memoryLabels[0] ?? "GÓI 32GB", 1080, y + 29); ctx.fillText(memoryLabels[1] ?? "GÓI 64GB", 1260, y + 29);
    y += 46;
    const variants = item.variants; ctx.fillStyle = "#ffffff"; ctx.fillRect(72, y, 1356, 98); ctx.strokeStyle = "#cbd5e1"; ctx.strokeRect(72, y, 1356, 98); ctx.fillStyle = "#334155"; ctx.font = "20px Arial"; ctx.fillText(String(index + 1).padStart(2, "0"), 94, y + 44); ctx.font = "700 21px Arial"; ctx.fillText(item.model.slice(0, 36), 175, y + 37); ctx.font = "16px Arial"; ctx.fillStyle = "#475569"; ctx.fillText(item.description.slice(0, 52), 670, y + 37); ctx.fillStyle = "#14344d"; ctx.font = "800 19px Arial"; ctx.fillText(formatCurrency(variants[0]?.price ?? 0), 1080, y + 48); ctx.fillText(formatCurrency(variants[1]?.price ?? 0), 1260, y + 48);
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png")); if (!blob) return setNotice("Không tạo được ảnh báo giá.");
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") { await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]); setNotice("Đã sao chép ảnh. Có thể dán trực tiếp vào Zalo hoặc Messenger."); } else { const link = document.createElement("a"); link.href = URL.createObjectURL(blob); link.download = "bao-gia-camera-hai-dang.png"; link.click(); URL.revokeObjectURL(link.href); setNotice("Trình duyệt đã tải ảnh báo giá xuống."); }
  }

  return <main className="min-h-full bg-slate-100 px-3 py-7 sm:px-6 sm:py-10"><div className="mx-auto max-w-6xl bg-white px-5 pb-10 pt-0 shadow-[0_18px_60px_rgba(15,23,42,.14)] sm:px-10" style={{ fontFamily: "Arial, sans-serif" }}>
    <div className="-mx-5 flex h-8 bg-[#12364f] sm:-mx-10"><div className="w-1/5 bg-[#078a82]" /></div>
    <header className="pt-14"><h1 className="text-4xl font-black leading-[1.08] tracking-tight text-[#14344d] sm:text-5xl">BẢNG GIÁ CHI TIẾT<br />LẮP ĐẶT CAMERA</h1><div className="mt-8 flex flex-col gap-2 bg-[#14344d] px-5 py-4 font-bold text-white sm:flex-row sm:items-center sm:justify-between"><span className="text-xl">HẢI ĐĂNG TECH</span><span>0868306286 - 0868506286</span></div></header>
    <div className="mt-7 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-black uppercase text-[#14344d]">Tổng quan {filtered.length} gói lựa chọn</h2><p className="mt-1 text-sm text-slate-500">Giá trọn gói theo model, đã gồm thẻ nhớ, vật tư cơ bản và lắp đặt.</p></div><label className="relative"><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm model..." className="w-44 border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#078a82]" /></label></div>
    {notice && <p className="mt-3 text-sm font-semibold text-[#0b7b74]">{notice}</p>}
    <section className="mt-4 overflow-x-auto border border-slate-300"><table className="w-full min-w-[820px] border-collapse text-left text-sm"><thead className="bg-[#0b7b74] text-white"><tr><th className="w-14 border-r border-white/40 px-3 py-3 text-center">Gói</th><th className="w-[28%] border-r border-white/40 px-3 py-3">Model camera</th><th className="border-r border-white/40 px-3 py-3">Vị trí phù hợp</th>{memoryLabels.map((label) => <th key={label} className="w-36 border-r border-white/40 px-3 py-3 text-right">{label}</th>)}<th className="w-12" /></tr></thead><tbody>{filtered.map((item, index) => <tr key={item.id} className={index % 2 ? "bg-slate-100" : "bg-white"}><td className="border border-slate-300 px-3 py-3 text-center text-slate-600">{String(index + 1).padStart(2, "0")}</td><td className="border border-slate-300 px-3 py-3 font-bold text-[#14344d]">{item.model}</td><td className="border border-slate-300 px-3 py-3 leading-5 text-slate-600">{item.description}</td>{item.variants.map((variant, variantIndex) => <td key={variant.id} className="border border-slate-300 px-3 py-3 text-right font-extrabold text-[#14344d]"><span>{formatCurrency(variant.price)}</span>{canEdit && <button onClick={() => { setEditing({ model: item, variant, label: memoryLabels[variantIndex] ?? "Gói" }); setPrice(String(variant.price)); }} className="ml-2 align-middle text-slate-400 hover:text-[#0b7b74]" aria-label={`Sửa giá ${item.model}`}><Edit3 className="inline h-3.5 w-3.5" /></button>}</td>)}<td className="border border-slate-300 px-2 text-center"><button onClick={() => copyImage(item, index)} className="inline-flex h-8 w-8 items-center justify-center text-[#0b7b74] hover:bg-teal-50" aria-label={`Sao chép ảnh ${item.model}`} title="Sao chép ảnh gói này"><Copy className="h-4 w-4" /></button></td></tr>)}</tbody></table></section>
    <footer className="mt-8 border-t border-slate-300 pt-3 text-xs text-slate-500">HẢI ĐĂNG TECH - Giá tham khảo, có thể điều chỉnh theo hiện trạng thi công. <span className="float-right">Trang 1</span></footer>
  </div>{editing && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4"><div className="w-full max-w-sm bg-white p-5 shadow-2xl"><div className="flex items-center justify-between"><h2 className="font-black text-[#14344d]">Sửa giá tạm thời</h2><button onClick={() => setEditing(null)}><X className="h-5 w-5" /></button></div><p className="mt-2 text-sm text-slate-500">{editing.model.model} · {editing.label}</p><input inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-4 w-full border border-slate-300 px-3 py-2.5 text-lg font-bold" /><div className="mt-4 flex justify-end gap-2"><button onClick={() => setEditing(null)} className="px-3 py-2 text-sm font-semibold">Hủy</button><button onClick={applyPrice} className="bg-[#0b7b74] px-3 py-2 text-sm font-semibold text-white">Áp dụng</button></div></div></div>}</main>;
}
