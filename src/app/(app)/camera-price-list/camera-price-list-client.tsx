"use client";

import { useMemo, useState } from "react";
import { Copy, Edit3, ImageOff, Search, X } from "lucide-react";
import Image from "next/image";
import { NumberInput } from "@/components/ui/number-input";
import { formatCurrency } from "@/lib/utils";

type Variant = {
  id: string;
  cameraId: string;
  cardId: string;
  cameraPrice: number;
  cardPrice: number;
  installationPrice: number;
  materialPrice: number;
  price: number;
};

type PriceKey =
  "cameraPrice" | "cardPrice" | "installationPrice" | "materialPrice" | "price";

type Model = {
  id: string;
  model: string;
  description: string;
  imageUrl: string | null;
  specs: Record<string, string[]>;
  variants: Variant[];
};

function detailsFor(model: Model) {
  const rows = Object.entries(model.specs).flatMap(([label, values]) =>
    values.length ? [[label, values.join(" · ")] as const] : [],
  );
  return rows.length
    ? rows.slice(0, 6)
    : [["Thông tin", model.description.split("\n")[0]] as const];
}

function canvasMemoryLabel(label: string, index: number) {
  const capacity =
    label.match(/\d+GB/i)?.[0] ?? `${index === 0 ? "32" : "64"}GB`;
  return `GÓI ${capacity.toUpperCase()}`;
}

function canvasWrap(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxWidth: number,
  lineHeight: number,
) {
  const words = text.split(/\s+/);
  let line = "";
  let lines = 0;
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && line) {
      ctx.fillText(line, x, y + lines * lineHeight);
      line = word;
      lines += 1;
    } else line = candidate;
  }
  if (line) ctx.fillText(line, x, y + lines * lineHeight);
  return lines + 1;
}

async function loadProductImage(url: string | null) {
  if (!url) return null;
  const response = await fetch(url);
  if (!response.ok) throw new Error("Không tải được ảnh sản phẩm.");
  return createImageBitmap(await response.blob());
}

export function CameraPriceListClient({
  models: initialModels,
  memoryLabels,
  canEdit,
}: {
  models: Model[];
  memoryLabels: string[];
  canEdit: boolean;
}) {
  const [models, setModels] = useState(initialModels);
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState<{
    model: Model;
    variant: Variant;
    label: string;
    key: PriceKey;
  } | null>(null);
  const [price, setPrice] = useState<number | null>(null);
  const [notice, setNotice] = useState("");
  const filtered = useMemo(
    () =>
      models.filter((item) =>
        `${item.model} ${item.description}`
          .toLocaleLowerCase("vi")
          .includes(query.toLocaleLowerCase("vi")),
      ),
    [models, query],
  );

  function openPriceEditor(
    model: Model,
    variant: Variant,
    label: string,
    key: PriceKey,
  ) {
    setEditing({ model, variant, label, key });
    setPrice(variant[key]);
  }

  function scrollToPackage(modelId: string) {
    document
      .getElementById(`camera-package-${modelId}`)
      ?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function applyPrice() {
    if (!editing) return;
    const value = price;
    if (value === null || !Number.isFinite(value) || value < 0)
      return setNotice("Giá chưa hợp lệ.");
    setModels((current) =>
      current.map((model) =>
        model.id !== editing.model.id
          ? model
          : {
              ...model,
              variants: model.variants.map((variant) => {
                if (variant.id !== editing.variant.id) return variant;
                const updated = { ...variant, [editing.key]: value };
                return editing.key === "price"
                  ? updated
                  : {
                      ...updated,
                      price:
                        updated.cameraPrice +
                        updated.cardPrice +
                        updated.installationPrice +
                        updated.materialPrice,
                    };
              }),
            },
      ),
    );
    setEditing(null);
    setNotice("Đã áp dụng giá tạm thời cho ảnh báo giá.");
  }

  async function copyImage(item: Model, index: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 1500;
    canvas.height = 1400;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#12364f";
    ctx.fillRect(0, 0, canvas.width, 34);
    ctx.fillStyle = "#078a82";
    ctx.fillRect(0, 0, 300, 34);
    ctx.fillStyle = "#078a82";
    ctx.fillRect(72, 84, 56, 56);
    ctx.fillStyle = "#ffffff";
    ctx.font = "800 28px Arial";
    ctx.fillText(String(index + 1), 89, 122);
    ctx.fillStyle = "#14344d";
    ctx.font = "800 38px Arial";
    ctx.fillText(
      `CHI TIẾT GÓI ${String(index + 1).padStart(2, "0")}`,
      154,
      110,
    );
    ctx.font = "24px Arial";
    ctx.fillStyle = "#64748b";
    ctx.fillText("Thông số, hình ảnh và hai lựa chọn thẻ nhớ", 154, 148);
    ctx.strokeStyle = "#b7c7d3";
    ctx.lineWidth = 2;

    try {
      const image = await loadProductImage(item.imageUrl);
      if (image) {
        const ratio = Math.min(380 / image.width, 380 / image.height);
        const width = image.width * ratio;
        const height = image.height * ratio;
        ctx.drawImage(
          image,
          110 + (380 - width) / 2,
          425 + (380 - height) / 2,
          width,
          height,
        );
        image.close();
      }
    } catch {
      /* The card still copies when an external image cannot be fetched. */
    }

    ctx.fillStyle = "#14344d";
    ctx.font = "800 34px Arial";
    canvasWrap(ctx, item.model, 540, 285, 480, 42);
    ctx.fillStyle = "#e1f1f1";
    ctx.fillRect(540, 375, 440, 42);
    ctx.fillStyle = "#087b74";
    ctx.font = "700 20px Arial";
    ctx.fillText("CAMERA CHÍNH HÃNG", 560, 403);
    const variants = item.variants;
    variants.forEach((variant, variantIndex) => {
      const y = 230 + variantIndex * 74;
      ctx.fillStyle = "#e6f3f3";
      ctx.fillRect(1065, y, 290, 64);
      ctx.strokeStyle = "#078a82";
      ctx.strokeRect(1065, y, 290, 64);
      ctx.fillStyle = "#64748b";
      ctx.font = "700 18px Arial";
      ctx.fillText(
        canvasMemoryLabel(memoryLabels[variantIndex] ?? "", variantIndex),
        1085,
        y + 26,
      );
      ctx.fillStyle = "#007e78";
      ctx.font = "800 24px Arial";
      ctx.fillText(formatCurrency(variant.price), 1085, y + 53);
    });
    ctx.fillStyle = "#14344d";
    ctx.font = "800 27px Arial";
    ctx.fillText("THÔNG SỐ KỸ THUẬT", 540, 490);
    let y = 520;
    detailsFor(item)
      .slice(0, 5)
      .forEach(([label, value]) => {
        ctx.fillStyle = "#edf3f6";
        ctx.fillRect(540, y, 245, 48);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(785, y, 570, 48);
        ctx.strokeStyle = "#cbd5e1";
        ctx.strokeRect(540, y, 815, 48);
        ctx.fillStyle = "#526675";
        ctx.font = "700 17px Arial";
        ctx.fillText(label, 557, y + 30);
        ctx.fillStyle = "#233947";
        ctx.font = "17px Arial";
        ctx.fillText(value.slice(0, 64), 804, y + 30);
        y += 48;
      });
    ctx.fillStyle = "#14344d";
    ctx.font = "700 21px Arial";
    y += 42;
    const description = item.description.split("\n").slice(0, 2).join(" ");
    const descriptionLines = canvasWrap(ctx, description, 540, y, 790, 28);
    y = Math.max(900, y + descriptionLines * 28 + 42);
    ctx.fillStyle = "#07817a";
    ctx.fillRect(540, y, 815, 42);
    ctx.fillStyle = "#ffffff";
    ctx.font = "700 18px Arial";
    ctx.fillText("HẠNG MỤC", 560, y + 27);
    ctx.textAlign = "center";
    variants.forEach((_, variantIndex) =>
      ctx.fillText(
        canvasMemoryLabel(memoryLabels[variantIndex] ?? "", variantIndex),
        1015 + variantIndex * 210,
        y + 27,
      ),
    );
    ctx.textAlign = "left";
    const items: Array<[string, keyof Variant]> = [
      ["Camera", "cameraPrice"],
      ["Thẻ nhớ", "cardPrice"],
      ["Công lắp đặt", "installationPrice"],
      ["Vật tư cơ bản", "materialPrice"],
      ["TỔNG TRỌN GÓI", "price"],
    ];
    items.forEach(([label, key], itemIndex) => {
      const rowY = y + 42 + itemIndex * 44;
      ctx.fillStyle = itemIndex === items.length - 1 ? "#e1f1f1" : "#ffffff";
      ctx.fillRect(540, rowY, 815, 44);
      ctx.strokeStyle = "#cbd5e1";
      ctx.strokeRect(540, rowY, 815, 44);
      ctx.fillStyle = "#263b4a";
      ctx.font =
        itemIndex === items.length - 1 ? "800 18px Arial" : "18px Arial";
      ctx.fillText(label, 560, rowY + 28);
      variants.forEach((variant, variantIndex) => {
        ctx.textAlign = "right";
        ctx.fillText(
          formatCurrency(Number(variant[key])),
          1115 + variantIndex * 210,
          rowY + 28,
        );
        ctx.textAlign = "left";
      });
    });
    const contentBottom = y + 42 + items.length * 44;
    ctx.strokeStyle = "#b7c7d3";
    ctx.strokeRect(72, 195, 1356, contentBottom - 165);
    ctx.fillStyle = "#64748b";
    ctx.font = "17px Arial";
    ctx.fillText(
      "Giá trọn gói đã bao gồm vật tư cơ bản và công lắp đặt.",
      72,
      contentBottom + 50,
    );
    ctx.fillText(
      "HẢI ĐĂNG TECH - 0868306286 - 0868506286",
      72,
      contentBottom + 90,
    );

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) return setNotice("Không tạo được ảnh báo giá.");
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      await navigator.clipboard.write([
        new ClipboardItem({ "image/png": blob }),
      ]);
      setNotice(
        `Đã sao chép ảnh chi tiết gói ${String(index + 1).padStart(2, "0")}.`,
      );
    } else {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = `bao-gia-camera-goi-${String(index + 1).padStart(2, "0")}.png`;
      link.click();
      URL.revokeObjectURL(link.href);
      setNotice("Trình duyệt đã tải ảnh báo giá xuống.");
    }
  }

  return (
    <main className="min-h-full bg-slate-100 px-3 py-7 sm:px-6 sm:py-10">
      <div
        className="mx-auto max-w-6xl bg-white px-5 pb-10 pt-0 shadow-[0_18px_60px_rgba(15,23,42,.14)] sm:px-10"
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        <div className="-mx-5 flex h-8 bg-[#12364f] sm:-mx-10">
          <div className="w-1/5 bg-[#078a82]" />
        </div>
        <header className="pt-14">
          <h1 className="text-4xl font-black leading-[1.08] tracking-tight text-[#14344d] sm:text-5xl">
            BẢNG GIÁ CHI TIẾT
            <br />
            LẮP ĐẶT CAMERA
          </h1>
          <div className="mt-8 flex flex-col gap-2 bg-[#14344d] px-5 py-4 font-bold text-white sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xl">HẢI ĐĂNG TECH</span>
            <span>0868306286 - 0868506286</span>
          </div>
        </header>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black uppercase text-[#14344d]">
              Tổng quan {filtered.length} gói lựa chọn
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Mỗi gói có trang chi tiết gồm ảnh sản phẩm, thông số và giá trọn
              gói như file báo giá.
            </p>
          </div>
          <label className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm model..."
              className="w-44 border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#078a82]"
            />
          </label>
        </div>
        {notice && (
          <p className="mt-3 text-sm font-semibold text-[#0b7b74]">{notice}</p>
        )}
        <section className="mt-4 space-y-3 md:hidden">
          {filtered.map((item, index) => (
            <article
              key={item.id}
              onClick={() => scrollToPackage(item.id)}
              className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-[0_4px_18px_rgba(15,23,42,.04)] transition active:bg-teal-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-bold text-[#078a82]">
                    GÓI {String(index + 1).padStart(2, "0")}
                  </p>
                  <h3 className="mt-1 text-base font-black leading-5 text-[#14344d]">
                    {item.model}
                  </h3>
                </div>
                <button
                  onClick={(event) => {
                    event.stopPropagation();
                    copyImage(item, index);
                  }}
                  className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-teal-200 bg-teal-50/60 text-[#0b7b74] transition hover:bg-teal-50"
                  aria-label={`Sao chép ảnh ${item.model}`}
                >
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">
                {item.description.split("\n")[0]}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {item.variants.map((variant, variantIndex) => (
                  <div
                    key={variant.id}
                    className="rounded-lg border border-teal-100 bg-[#edf7f7] p-2.5"
                  >
                    <p className="text-[10px] font-bold leading-4 text-slate-500">
                      {canvasMemoryLabel(
                        memoryLabels[variantIndex] ?? "",
                        variantIndex,
                      )}
                    </p>
                    <div className="mt-1 flex items-center justify-between gap-1">
                      <p className="text-sm font-black text-[#007e78]">
                        {formatCurrency(variant.price)}
                      </p>
                      {canEdit && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openPriceEditor(
                              item,
                              variant,
                              memoryLabels[variantIndex] ?? "Gói",
                              "price",
                            );
                          }}
                          className="text-slate-400 hover:text-[#0b7b74]"
                          aria-label={`Sửa giá ${item.model}`}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
        <section className="mt-4 hidden overflow-x-auto border border-slate-300 md:block">
          <table className="w-full min-w-[820px] border-collapse text-left text-sm">
            <thead className="bg-[#0b7b74] text-white">
              <tr>
                <th className="w-14 border-r border-white/40 px-3 py-3 text-center">
                  Gói
                </th>
                <th className="w-[28%] border-r border-white/40 px-3 py-3">
                  Model camera
                </th>
                <th className="border-r border-white/40 px-3 py-3">
                  Vị trí phù hợp
                </th>
                {memoryLabels.map((label) => (
                  <th
                    key={label}
                    className="w-36 border-r border-white/40 px-3 py-3 text-right"
                  >
                    {label}
                  </th>
                ))}
                <th className="w-12" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, index) => (
                <tr
                  key={item.id}
                  onClick={() => scrollToPackage(item.id)}
                  className={`${index % 2 ? "bg-slate-100" : "bg-white"} cursor-pointer hover:bg-teal-50/60`}
                >
                  <td className="border border-slate-300 px-3 py-3 text-center text-slate-600">
                    {String(index + 1).padStart(2, "0")}
                  </td>
                  <td className="border border-slate-300 px-3 py-3 font-bold text-[#14344d]">
                    {item.model}
                  </td>
                  <td className="border border-slate-300 px-3 py-3 leading-5 text-slate-600">
                    {item.description.split("\n")[0]}
                  </td>
                  {item.variants.map((variant, variantIndex) => (
                    <td
                      key={variant.id}
                      className="border border-slate-300 px-3 py-3 text-right font-extrabold text-[#14344d]"
                    >
                      <span>{formatCurrency(variant.price)}</span>
                      {canEdit && (
                        <button
                          onClick={(event) => {
                            event.stopPropagation();
                            openPriceEditor(
                              item,
                              variant,
                              memoryLabels[variantIndex] ?? "Gói",
                              "price",
                            );
                          }}
                          className="ml-2 align-middle text-slate-400 hover:text-[#0b7b74]"
                          aria-label={`Sửa giá ${item.model}`}
                        >
                          <Edit3 className="inline h-3.5 w-3.5" />
                        </button>
                      )}
                    </td>
                  ))}
                  <td className="border border-slate-300 px-2 text-center">
                    <button
                      onClick={(event) => {
                        event.stopPropagation();
                        copyImage(item, index);
                      }}
                      className="inline-flex h-8 w-8 items-center justify-center text-[#0b7b74] hover:bg-teal-50"
                      aria-label={`Sao chép ảnh ${item.model}`}
                      title="Sao chép ảnh chi tiết gói này"
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
        <div className="mt-8 space-y-6 sm:mt-12 sm:space-y-12">
          {filtered.map((item, index) => (
            <article
              id={`camera-package-${item.id}`}
              key={item.id}
              className="scroll-mt-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-[0_12px_36px_rgba(15,23,42,.055)] sm:p-8"
            >
              <header className="flex items-start gap-4">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-[#078a82] text-xl font-black text-white">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h2 className="text-2xl font-black uppercase text-[#14344d]">
                    {item.model}
                  </h2>
                  <p className="mt-1 text-slate-500">
                    Thông số, hình ảnh và hai lựa chọn thẻ nhớ của từng model.
                  </p>
                </div>
              </header>
              <div className="mt-7 grid overflow-hidden rounded-xl border border-slate-200 bg-white lg:grid-cols-[330px_1fr]">
                <div className="flex min-h-80 items-center justify-center border-b border-slate-200 bg-slate-50/35 p-6 lg:border-b-0 lg:border-r">
                  {item.imageUrl ? (
                      <Image
                        src={item.imageUrl}
                        alt={item.model}
                        width={288}
                        height={288}
                        unoptimized
                        className="max-h-72 max-w-full object-contain"
                      />
                  ) : (
                    <div className="text-center text-slate-400">
                      <ImageOff className="mx-auto h-10 w-10" />
                      <p className="mt-3 text-sm">Chưa có ảnh sản phẩm</p>
                    </div>
                  )}
                </div>
                <div className="p-5 sm:p-7">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h3 className="text-2xl font-black text-[#14344d]">
                        {item.model}
                      </h3>
                      <p className="mt-3 inline-block bg-[#e1f1f1] px-3 py-1 text-sm font-bold text-[#087b74]">
                        Camera chính hãng
                      </p>
                    </div>
                    <button
                      onClick={() => copyImage(item, index)}
                      className="inline-flex items-center justify-center gap-2 rounded-lg border border-teal-200 bg-white px-3.5 py-2.5 text-sm font-bold text-[#087b74] shadow-[0_2px_8px_rgba(8,129,122,.06)] transition hover:border-teal-300 hover:bg-teal-50"
                    >
                      <Copy className="h-4 w-4" />
                      Sao chép ảnh gói
                    </button>
                  </div>
                  <div className="mt-6 grid gap-2 sm:grid-cols-2">
                    {item.variants.map((variant, variantIndex) => (
                      <div
                        key={variant.id}
                        className="rounded-xl border border-teal-100 bg-[#edf7f7] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
                      >
                        <p className="text-sm font-bold text-slate-500">
                          {memoryLabels[variantIndex] ??
                            `Gói ${variantIndex + 1}`}
                        </p>
                        <p className="mt-1 text-xl font-black text-[#007e78]">
                          {formatCurrency(variant.price)}
                        </p>
                      </div>
                    ))}
                  </div>
                  <h4 className="mt-7 text-lg font-black text-[#14344d]">
                    THÔNG SỐ KỸ THUẬT
                  </h4>
                  <dl className="mt-2 overflow-hidden rounded-lg border border-slate-200 divide-y divide-slate-200">
                    {detailsFor(item).map(([label, value]) => (
                      <div
                        key={label}
                        className="grid grid-cols-[minmax(120px,30%)_1fr]"
                      >
                        <dt className="bg-slate-100 px-3 py-2 font-bold text-slate-500">
                          {label}
                        </dt>
                        <dd className="px-3 py-2 text-slate-700">{value}</dd>
                      </div>
                    ))}
                  </dl>
                  <p className="mt-5 whitespace-pre-line text-sm leading-6 text-slate-700">
                    {item.description}
                  </p>
                  <div className="mt-6 space-y-2 sm:hidden">
                    {(
                      [
                        ["Camera", "cameraPrice"],
                        ["Thẻ nhớ", "cardPrice"],
                        ["Công lắp đặt", "installationPrice"],
                        ["Vật tư cơ bản", "materialPrice"],
                        ["TỔNG TRỌN GÓI", "price"],
                      ] as const
                    ).map(([label, key]) => (
                      <div
                        key={key}
                        className={`border border-slate-300 p-3 ${key === "price" ? "bg-[#e1f1f1]" : "bg-white"}`}
                      >
                        <p className="text-xs font-black uppercase text-[#14344d]">
                          {label}
                        </p>
                        <div className="mt-2 grid grid-cols-2 gap-3">
                          {item.variants.map((variant, variantIndex) => (
                            <div key={variant.id} className="min-w-0">
                              <p className="text-[10px] font-bold text-slate-500">
                                {canvasMemoryLabel(memoryLabels[variantIndex] ?? "", variantIndex)}
                              </p>
                              <div className="mt-1 flex items-center gap-1">
                                <span className="min-w-0 text-sm font-black text-[#14344d]">
                                  {formatCurrency(variant[key])}
                                </span>
                                {canEdit && (
                                  <button
                                    onClick={() => openPriceEditor(item, variant, `${label} · ${memoryLabels[variantIndex] ?? "Gói"}`, key)}
                                    className="shrink-0 text-slate-400 hover:text-[#0b7b74]"
                                    aria-label={`Sửa ${label} ${item.model}`}
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                  </button>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <table className="mt-6 hidden w-full border-collapse text-sm sm:table">
                    <thead className="bg-[#07817a] text-white">
                      <tr>
                        <th className="border border-white/40 px-3 py-2 text-left">
                          Hạng mục
                        </th>
                        {memoryLabels.map((label) => (
                          <th
                            key={label}
                            className="border border-white/40 px-3 py-2 text-right"
                          >
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {(
                        [
                          ["Camera", "cameraPrice"],
                          ["Thẻ nhớ", "cardPrice"],
                          ["Công lắp đặt", "installationPrice"],
                          ["Vật tư cơ bản", "materialPrice"],
                          ["TỔNG TRỌN GÓI", "price"],
                        ] as const
                      ).map(([label, key]) => (
                        <tr
                          key={key}
                          className={
                            key === "price"
                              ? "bg-[#e1f1f1] font-black"
                              : "bg-white"
                          }
                        >
                          <td className="border border-slate-300 px-3 py-2">
                            {label}
                          </td>
                          {item.variants.map((variant, variantIndex) => (
                            <td
                              key={variant.id}
                              className="border border-slate-300 px-3 py-2 text-right"
                            >
                              <span>{formatCurrency(variant[key])}</span>
                              {canEdit && (
                                <button
                                  onClick={() =>
                                    openPriceEditor(
                                      item,
                                      variant,
                                      `${label} · ${memoryLabels[variantIndex] ?? "Gói"}`,
                                      key,
                                    )
                                  }
                                  className="ml-2 align-middle text-slate-400 hover:text-[#0b7b74]"
                                  aria-label={`Sửa ${label} ${item.model}`}
                                >
                                  <Edit3 className="inline h-3.5 w-3.5" />
                                </button>
                              )}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="mt-3 text-xs text-slate-500">
                    Thẻ nhớ chuyên dụng cho camera. Giá trọn gói đã gồm vật tư
                    cơ bản và công lắp đặt.
                  </p>
                </div>
              </div>
            </article>
          ))}
        </div>
        <footer className="mt-8 border-t border-slate-300 pt-3 text-xs text-slate-500">
          HẢI ĐĂNG TECH - Giá tham khảo, có thể điều chỉnh theo hiện trạng thi
          công.
        </footer>
      </div>
      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
          <div className="w-full max-w-sm bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-[#14344d]">Sửa giá tạm thời</h2>
              <button onClick={() => setEditing(null)}>
                <X className="h-5 w-5" />
              </button>
            </div>
            <p className="mt-2 text-sm text-slate-500">
              {editing.model.model} · {editing.label}
            </p>
            <div className="mt-4">
              <NumberInput
                value={price}
                onChange={setPrice}
                thousandSeparator
                min={0}
                decimals={0}
                suffix="đ"
                aria-label="Giá tạm thời"
                className="h-12 border-slate-200 bg-white pr-10 text-left text-lg font-bold tabular-nums focus:border-[#078a82]"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="px-3 py-2 text-sm font-semibold"
              >
                Hủy
              </button>
              <button
                onClick={applyPrice}
                className="bg-[#0b7b74] px-3 py-2 text-sm font-semibold text-white"
              >
                Áp dụng
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
