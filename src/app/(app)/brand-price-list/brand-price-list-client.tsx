"use client";

import { useMemo, useState } from "react";
import { Copy, Edit3, ImageOff, Search, X } from "lucide-react";
import Image from "next/image";
import type { BrandPriceListProduct } from "@/lib/data/brand-price-lists";
import { formatCurrency } from "@/lib/utils";

type Palette = {
  ink: string;
  accent: string;
  soft: string;
  stripe: string;
};

type Props = {
  brand: string;
  eyebrow: string;
  title: string;
  subtitle: string;
  products: BrandPriceListProduct[];
  canEdit: boolean;
  palette: Palette;
};

function groupProducts(products: BrandPriceListProduct[]) {
  const groups = new Map<string, BrandPriceListProduct[]>();
  for (const product of products) {
    const key = product.category || "Sản phẩm khác";
    groups.set(key, [...(groups.get(key) ?? []), product]);
  }
  return [...groups.entries()];
}

function productDetails(product: BrandPriceListProduct) {
  const details = Object.entries(product.specs)
    .filter(([, values]) => values.length)
    .slice(0, 5)
    .map(([label, values]) => [label, values.join(" · ")] as const);
  if (details.length) return details;
  return [
    ["Mã sản phẩm", product.sku],
    ["Đơn vị", product.baseUnit],
    ...(product.warrantyMonths
      ? ([["Bảo hành", `${product.warrantyMonths} tháng`]] as const)
      : []),
  ];
}

function wrapText(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  width: number,
  lineHeight: number,
  maxLines = 3,
) {
  const words = text.split(/\s+/);
  let line = "";
  let lineIndex = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > width) {
      context.fillText(line, x, y + lineIndex * lineHeight);
      line = word;
      lineIndex += 1;
      if (lineIndex >= maxLines) return lineIndex;
    } else {
      line = candidate;
    }
  }
  if (line && lineIndex < maxLines) context.fillText(line, x, y + lineIndex * lineHeight);
  return lineIndex + 1;
}

async function loadImage(url: string | null) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) return null;
  return createImageBitmap(await response.blob());
}

export function BrandPriceListClient({
  brand,
  eyebrow,
  title,
  subtitle,
  products: initialProducts,
  canEdit,
  palette,
}: Props) {
  const [products, setProducts] = useState(initialProducts);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<BrandPriceListProduct | null>(null);
  const [price, setPrice] = useState("");
  const [notice, setNotice] = useState("");

  const filtered = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("vi");
    return normalized
      ? products.filter((product) =>
          `${product.name} ${product.sku} ${product.category ?? ""}`
            .toLocaleLowerCase("vi")
            .includes(normalized),
        )
      : products;
  }, [products, query]);
  const groups = useMemo(() => groupProducts(filtered), [filtered]);

  function openEditor(product: BrandPriceListProduct) {
    setEditing(product);
    setPrice(String(product.retailPrice));
  }

  function applyPrice() {
    if (!editing) return;
    const value = Number(price.replace(/[^0-9]/g, ""));
    if (!Number.isFinite(value) || value < 0) {
      setNotice("Giá chưa hợp lệ.");
      return;
    }
    setProducts((current) =>
      current.map((product) =>
        product.id === editing.id ? { ...product, retailPrice: value } : product,
      ),
    );
    setEditing(null);
    setNotice("Đã áp dụng giá tạm thời cho ảnh báo giá.");
  }

  async function copyProductImage(product: BrandPriceListProduct) {
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 1200;
    const context = canvas.getContext("2d");
    if (!context) return;

    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = palette.ink;
    context.fillRect(0, 0, canvas.width, 150);
    context.fillStyle = palette.accent;
    context.fillRect(0, 0, 28, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = "800 24px Arial";
    context.fillText("HẢI ĐĂNG TECH", 72, 62);
    context.font = "18px Arial";
    context.fillText(`${brand.toUpperCase()} · BẢNG GIÁ THIẾT BỊ CHÍNH HÃNG`, 72, 102);

    try {
      const image = await loadImage(product.imageUrl);
      if (image) {
        const ratio = Math.min(430 / image.width, 430 / image.height);
        const width = image.width * ratio;
        const height = image.height * ratio;
        context.drawImage(image, 70 + (430 - width) / 2, 220 + (430 - height) / 2, width, height);
        image.close();
      }
    } catch {
      // Keep generating a useful quote image when the remote image blocks CORS.
    }

    context.fillStyle = palette.ink;
    context.font = "800 39px Arial";
    wrapText(context, product.fullName || product.name, 560, 245, 560, 48, 3);
    context.fillStyle = palette.accent;
    context.font = "800 22px Arial";
    context.fillText(product.sku, 560, 405);
    context.fillStyle = palette.soft;
    context.fillRect(560, 445, 560, 118);
    context.fillStyle = palette.ink;
    context.font = "700 20px Arial";
    context.fillText("GIÁ BÁN THAM KHẢO", 590, 485);
    context.fillStyle = palette.accent;
    context.font = "900 42px Arial";
    context.fillText(formatCurrency(product.retailPrice), 590, 540);

    let y = 690;
    context.font = "700 18px Arial";
    for (const [label, value] of productDetails(product).slice(0, 5)) {
      context.fillStyle = "#eef2f5";
      context.fillRect(70, y, 250, 54);
      context.fillStyle = "#ffffff";
      context.fillRect(320, y, 800, 54);
      context.strokeStyle = "#cbd5e1";
      context.strokeRect(70, y, 1050, 54);
      context.fillStyle = "#526675";
      context.fillText(label, 88, y + 34);
      context.fillStyle = "#233947";
      context.font = "18px Arial";
      context.fillText(value.slice(0, 88), 342, y + 34);
      context.font = "700 18px Arial";
      y += 54;
    }
    context.fillStyle = "#64748b";
    context.font = "18px Arial";
    context.fillText("HẢI ĐĂNG TECH · 0868306286 · 0868506286", 70, 1125);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) return setNotice("Không tạo được ảnh báo giá.");
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
      setNotice(`Đã sao chép ảnh báo giá ${product.name}.`);
      return;
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `bao-gia-${brand.toLocaleLowerCase("vi").replace(/\s+/g, "-")}-${product.sku}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
    setNotice("Trình duyệt đã tải ảnh báo giá xuống.");
  }

  return (
    <main className="min-h-full bg-slate-100 px-3 py-7 sm:px-6 sm:py-10">
      <div className="mx-auto max-w-6xl bg-white shadow-[0_18px_60px_rgba(15,23,42,.14)]">
        <div className="flex h-8" style={{ background: palette.ink }}>
          <div className="w-1/4" style={{ background: palette.accent }} />
        </div>
        <header className="px-5 pb-8 pt-12 sm:px-10 sm:pt-16">
          <p className="text-sm font-black uppercase tracking-[.24em]" style={{ color: palette.accent }}>
            {eyebrow}
          </p>
          <h1 className="mt-3 max-w-4xl text-4xl font-black uppercase leading-[1.05] tracking-tight sm:text-6xl" style={{ color: palette.ink }}>
            {title}
          </h1>
          <p className="mt-5 max-w-2xl text-base leading-7 text-slate-600">{subtitle}</p>
          <div className="mt-8 flex flex-col gap-2 px-5 py-4 font-bold text-white sm:flex-row sm:items-center sm:justify-between" style={{ background: palette.ink }}>
            <span className="text-xl">HẢI ĐĂNG TECH</span>
            <span>0868306286 · 0868506286</span>
          </div>
        </header>

        <section className="border-y border-slate-200 px-5 py-5 sm:px-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-black uppercase" style={{ color: palette.ink }}>
                {filtered.length} sản phẩm · {groups.length} nhóm
              </p>
              <p className="mt-1 text-sm text-slate-500">Chạm vào biểu tượng sao chép để gửi riêng từng sản phẩm cho khách.</p>
            </div>
            <label className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Tìm tên hoặc mã..."
                className="w-full border border-slate-300 py-2.5 pl-9 pr-3 text-base outline-none focus:border-slate-500 sm:w-64 sm:text-sm"
              />
            </label>
          </div>
          {notice && <p className="mt-3 text-sm font-semibold" style={{ color: palette.accent }}>{notice}</p>}
        </section>

        <div className="space-y-10 px-5 py-9 sm:px-10 sm:py-12">
          {!filtered.length && (
            <div className="border border-dashed border-slate-300 px-6 py-16 text-center">
              <p className="font-bold text-slate-700">Chưa có sản phẩm phù hợp.</p>
              <p className="mt-2 text-sm text-slate-500">Kiểm tra lại từ khóa hoặc dữ liệu thương hiệu trong catalog.</p>
            </div>
          )}
          {groups.map(([category, items]) => (
            <section key={category}>
              <div className="mb-4 flex items-end justify-between border-b-2 pb-3" style={{ borderColor: palette.accent }}>
                <h2 className="text-xl font-black uppercase" style={{ color: palette.ink }}>{category}</h2>
                <span className="text-xs font-bold text-slate-400">{items.length} sản phẩm</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2">
                {items.map((product) => (
                  <article key={product.id} className="grid grid-cols-[112px_1fr] border border-slate-200 bg-white sm:grid-cols-[160px_1fr]">
                    <div className="flex min-h-40 items-center justify-center border-r border-slate-200 p-3">
                      {product.imageUrl ? (
                        <Image
                          src={product.imageUrl}
                          alt={product.name}
                          width={144}
                          height={144}
                          unoptimized
                          className="max-h-36 max-w-full object-contain"
                        />
                      ) : (
                        <div className="text-center text-slate-300"><ImageOff className="mx-auto h-8 w-8" /><span className="mt-2 block text-[10px]">Chưa có ảnh</span></div>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-col p-4">
                      <p className="text-[11px] font-black uppercase tracking-wider" style={{ color: palette.accent }}>{product.sku}</p>
                      <h3 className="mt-1 text-base font-black leading-5" style={{ color: palette.ink }}>{product.name}</h3>
                      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{product.description || "Thiết bị chính hãng, bảo hành theo tiêu chuẩn nhà sản xuất."}</p>
                      <div className="mt-auto flex items-end justify-between gap-3 pt-4">
                        <div>
                          <p className="text-[10px] font-bold uppercase text-slate-400">Giá bán</p>
                          <p className="text-lg font-black" style={{ color: palette.accent }}>{formatCurrency(product.retailPrice)}</p>
                        </div>
                        <div className="flex gap-1">
                          {canEdit && (
                            <button onClick={() => openEditor(product)} className="grid h-9 w-9 place-items-center border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label={`Sửa giá ${product.name}`}>
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}
                          <button onClick={() => copyProductImage(product)} className="grid h-9 w-9 place-items-center border text-white" style={{ background: palette.accent, borderColor: palette.accent }} aria-label={`Sao chép ảnh ${product.name}`}>
                            <Copy className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          ))}
        </div>
        <footer className="mx-5 border-t border-slate-200 py-5 text-xs text-slate-500 sm:mx-10">
          Giá tham khảo, có thể thay đổi theo thời điểm và hiện trạng thi công. Vui lòng liên hệ Hải Đăng Tech để xác nhận.
        </footer>
      </div>

      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
          <div className="w-full max-w-sm bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-black" style={{ color: palette.ink }}>Sửa giá tạm thời</h2>
              <button onClick={() => setEditing(null)} aria-label="Đóng"><X className="h-5 w-5" /></button>
            </div>
            <p className="mt-2 text-sm text-slate-500">{editing.name}</p>
            <input autoFocus inputMode="numeric" value={price} onChange={(event) => setPrice(event.target.value)} className="mt-4 w-full border border-slate-300 px-3 py-2.5 text-lg font-bold" />
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setEditing(null)} className="px-3 py-2 text-sm font-semibold">Hủy</button>
              <button onClick={applyPrice} className="px-4 py-2 text-sm font-bold text-white" style={{ background: palette.accent }}>Áp dụng</button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
