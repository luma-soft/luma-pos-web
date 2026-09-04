"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList, Copy, Edit3, ImageOff, ListChecks, Search, X } from "lucide-react";
import Image from "next/image";
import { NumberInput } from "@/components/ui/number-input";
import { LumaActionMenu } from "@/components/ui/action-menu";
import {
  cameraQuoteCopyLayout,
  type CameraQuoteCopyMode,
} from "@/lib/camera-quote-copy";
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
  storageEstimate: string;
};

type PriceKey =
  "cameraPrice" | "cardPrice" | "installationPrice" | "materialPrice" | "price";

type Model = {
  id: string;
  model: string;
  description: string;
  imageUrl: string | null;
  specs: Record<string, string[]>;
  installationLocation: "Trong nhà" | "Ngoài trời";
  suitableFor: string[];
  variants: Variant[];
};

function detailsFor(model: Model) {
  const rows = Object.entries(model.specs).flatMap(([label, values]) =>
    values.length ? [[label, values.join(" · ")] as const] : [],
  );
  return [
    ["Vị trí lắp đặt", model.installationLocation] as const,
    ...(rows.length
      ? rows
      : [["Thông tin", model.description.split("\n")[0]] as const]),
  ];
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
  const lines = canvasLines(ctx, text, maxWidth);
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight));
  return lines.length;
}

function canvasLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
) {
  return text.split(/\r?\n/).flatMap((paragraph) => {
    const words = paragraph.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width > maxWidth && line) {
        lines.push(line);
        line = word;
      } else line = candidate;
    }
    if (line) lines.push(line);
    return lines.length ? lines : [""];
  });
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
  brandName,
}: {
  models: Model[];
  memoryLabels: string[];
  canEdit: boolean;
  brandName: "EZVIZ" | "IMOU";
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
  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 3200);
    return () => window.clearTimeout(timeout);
  }, [notice]);
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

  async function deliverCanvasImage({
    canvas,
    downloadName,
    copiedMessage,
    downloadedMessage,
  }: {
    canvas: HTMLCanvasElement;
    downloadName: string;
    copiedMessage: string;
    downloadedMessage: string;
  }) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/png"),
    );
    if (!blob) return setNotice("Không tạo được ảnh.");
    const downloadImage = () => {
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = downloadName;
      link.click();
      URL.revokeObjectURL(link.href);
    };
    if (navigator.clipboard?.write && typeof ClipboardItem !== "undefined") {
      try {
        await navigator.clipboard.write([
          new ClipboardItem({ "image/png": blob }),
        ]);
        setNotice(copiedMessage);
        return;
      } catch {
        downloadImage();
        setNotice(downloadedMessage);
        return;
      }
    }
    downloadImage();
    setNotice(downloadedMessage);
  }

  async function copySpecsImage(item: Model, index: number) {
    const canvas = document.createElement("canvas");
    canvas.width = 1500;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const rows = detailsFor(item);
    const tableX = 420;
    const tableY = 145;
    const tableWidth = 1030;
    const labelWidth = 300;
    const valueWidth = tableWidth - labelWidth;
    ctx.font = "25px Arial";
    const rowHeights = rows.map(([label, value]) => {
      const labelLines = canvasLines(ctx, label, labelWidth - 40).length;
      const valueLines = canvasLines(ctx, value, valueWidth - 40).length;
      return Math.max(72, Math.max(labelLines, valueLines) * 32 + 30);
    });
    const tableHeight = rowHeights.reduce((total, height) => total + height, 0);
    canvas.height = Math.max(820, tableY + tableHeight + 70);

    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#14344d";
    ctx.font = "800 31px Arial";
    ctx.fillText("THÔNG SỐ KỸ THUẬT", tableX, 94);

    let image: ImageBitmap | null = null;
    try {
      image = await loadProductImage(item.imageUrl);
    } catch {
      setNotice("Không tải được ảnh sản phẩm để sao chép.");
      return;
    }
    if (!image) {
      setNotice("Camera này chưa có ảnh sản phẩm để sao chép.");
      return;
    }
    const imageBoxWidth = 340;
    const imageBoxHeight = Math.max(420, Math.min(580, tableHeight - 40));
    const imageRatio = Math.min(
      imageBoxWidth / image.width,
      imageBoxHeight / image.height,
    );
    const imageWidth = image.width * imageRatio;
    const imageHeight = image.height * imageRatio;
    ctx.drawImage(
      image,
      40 + (imageBoxWidth - imageWidth) / 2,
      tableY + (tableHeight - imageHeight) / 2,
      imageWidth,
      imageHeight,
    );
    image.close();

    let rowY = tableY;
    rows.forEach(([label, value], rowIndex) => {
      const rowHeight = rowHeights[rowIndex];
      ctx.fillStyle = "#edf3f6";
      ctx.fillRect(tableX, rowY, labelWidth, rowHeight);
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(tableX + labelWidth, rowY, valueWidth, rowHeight);
      ctx.strokeStyle = "#cbd5e1";
      ctx.lineWidth = 1.5;
      ctx.strokeRect(tableX, rowY, labelWidth + valueWidth, rowHeight);
      ctx.fillStyle = "#526675";
      ctx.font = "700 24px Arial";
      canvasWrap(
        ctx,
        label,
        tableX + 22,
        rowY + 43,
        labelWidth - 40,
        32,
      );
      ctx.fillStyle = "#233947";
      ctx.font = "24px Arial";
      canvasWrap(
        ctx,
        value,
        tableX + labelWidth + 22,
        rowY + 43,
        valueWidth - 40,
        32,
      );
      rowY += rowHeight;
    });

    await deliverCanvasImage({
      canvas,
      downloadName: `thong-so-camera-${String(index + 1).padStart(2, "0")}.png`,
      copiedMessage: `Đã sao chép ảnh thông số ${item.model}.`,
      downloadedMessage: "Không thể sao chép; ảnh thông số đã được tải xuống.",
    });
  }

  async function copyQuoteImage(
    item: Model,
    index: number,
    mode: Exclude<CameraQuoteCopyMode, "camera-only">,
  ) {
    const layout = cameraQuoteCopyLayout(mode);
    const canvas = document.createElement("canvas");
    canvas.width = 1500;
    canvas.height = 1900;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = "#12364f";
    ctx.fillRect(0, 0, canvas.width, 34);
    ctx.fillStyle = "#078a82";
    ctx.fillRect(0, 0, 300, 34);
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
          270 + (380 - height) / 2,
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
    canvasWrap(ctx, item.model, 540, 135, 480, 42);
    const variants = item.variants;
    if (layout.showPriceSummary) {
      variants.forEach((variant, variantIndex) => {
        const x = 1065 + (variantIndex % 2) * 150;
        const y = 90 + Math.floor(variantIndex / 2) * 88;
        ctx.fillStyle = "#e6f3f3";
        ctx.fillRect(x, y, 140, 78);
        ctx.strokeStyle = "#078a82";
        ctx.strokeRect(x, y, 140, 78);
        ctx.fillStyle = "#64748b";
        ctx.font = "700 14px Arial";
        ctx.fillText(
          canvasMemoryLabel(memoryLabels[variantIndex] ?? "", variantIndex),
          x + 12,
          y + 26,
        );
        ctx.fillStyle = "#007e78";
        ctx.font = "800 16px Arial";
        ctx.fillText(formatCurrency(variant.price), x + 12, y + 49);
        ctx.fillStyle = "#64748b";
        ctx.font = "11px Arial";
        ctx.fillText(`Lưu ${variant.storageEstimate}`, x + 12, y + 68);
      });
    }
    ctx.fillStyle = "#14344d";
    ctx.font = "800 27px Arial";
    ctx.fillText("THÔNG SỐ KỸ THUẬT", 540, 340);
    let y = 370;
    detailsFor(item)
      .forEach(([label, value]) => {
        ctx.font = "17px Arial";
        const valueLineCount = canvasLines(ctx, value, 530).length;
        const rowHeight = Math.max(48, valueLineCount * 22 + 20);
        ctx.fillStyle = "#edf3f6";
        ctx.fillRect(540, y, 245, rowHeight);
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(785, y, 570, rowHeight);
        ctx.strokeStyle = "#cbd5e1";
        ctx.strokeRect(540, y, 815, rowHeight);
        ctx.fillStyle = "#526675";
        ctx.font = "700 17px Arial";
        ctx.fillText(label, 557, y + 30);
        ctx.fillStyle = "#233947";
        ctx.font = "17px Arial";
        canvasWrap(ctx, value, 804, y + 30, 530, 22);
        y += rowHeight;
      });

    const suitableSectionX = 540;
    const suitableSectionWidth = 815;
    y += 30;
    ctx.font = "17px Arial";
    const suitableLines = item.suitableFor.flatMap((recommendation) =>
      canvasLines(ctx, `• ${recommendation}`, suitableSectionWidth - 40),
    );
    const suitableSectionHeight = Math.max(
      76,
      59 + suitableLines.length * 26,
    );
    ctx.fillStyle = "#f0fdfa";
    ctx.fillRect(
      suitableSectionX,
      y,
      suitableSectionWidth,
      suitableSectionHeight,
    );
    ctx.strokeStyle = "#99f6e4";
    ctx.strokeRect(
      suitableSectionX,
      y,
      suitableSectionWidth,
      suitableSectionHeight,
    );
    ctx.fillStyle = "#0b7b74";
    ctx.font = "800 17px Arial";
    ctx.fillText("PHÙ HỢP CHO", suitableSectionX + 20, y + 31);
    ctx.fillStyle = "#334155";
    ctx.font = "17px Arial";
    suitableLines.forEach((line, lineIndex) => {
      ctx.fillText(line, suitableSectionX + 20, y + 64 + lineIndex * 26);
    });

    ctx.fillStyle = "#14344d";
    ctx.font = "17px Arial";
    y += suitableSectionHeight + 42;
    const description = item.description;
    const descriptionLines = canvasWrap(ctx, description, 540, y, 790, 24);
    y = Math.max(900, y + descriptionLines * 24 + 42);
    let contentBottom = y;
    if (layout.showPriceBreakdown) {
      ctx.fillStyle = "#07817a";
      ctx.fillRect(540, y, 815, 42);
      ctx.fillStyle = "#ffffff";
      ctx.font = "700 18px Arial";
      ctx.fillText("HẠNG MỤC", 560, y + 27);
      const variantColumnWidth = 575 / variants.length;
      ctx.textAlign = "center";
      variants.forEach((_, variantIndex) =>
        ctx.fillText(
          canvasMemoryLabel(memoryLabels[variantIndex] ?? "", variantIndex),
          780 + variantColumnWidth * (variantIndex + 0.5),
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
            780 + variantColumnWidth * (variantIndex + 1) - 16,
            rowY + 28,
          );
          ctx.textAlign = "left";
        });
      });
      contentBottom = y + 42 + items.length * 44;
    }
    ctx.strokeStyle = "#b7c7d3";
    ctx.strokeRect(72, 58, 1356, contentBottom - 28);
    ctx.fillStyle = "#64748b";
    ctx.font = "17px Arial";
    ctx.fillText(
      "Giá trọn gói đã bao gồm vật tư cơ bản và công lắp đặt.",
      72,
      contentBottom + 50,
    );
    ctx.fillText(
      "Thời gian lưu là ước tính khi ghi liên tục; thực tế tùy cài đặt và bối cảnh ghi hình.",
      72,
      contentBottom + 78,
    );
    ctx.fillText(
      "Có thể phát sinh chi phí theo thực tế (đi dây, vật tư bổ sung hoặc vị trí lắp đặt khó); sẽ báo trước khi thực hiện.",
      72,
      contentBottom + 106,
    );
    ctx.fillText(
      "HẢI ĐĂNG TECH - 0868306286 - 0868506286",
      72,
      contentBottom + 146,
    );

    const outputCanvas = document.createElement("canvas");
    outputCanvas.width = canvas.width;
    outputCanvas.height = Math.ceil(contentBottom + 190);
    const outputContext = outputCanvas.getContext("2d");
    if (!outputContext) return;
    outputContext.drawImage(canvas, 0, 0);

    await deliverCanvasImage({
      canvas: outputCanvas,
      downloadName: `${mode === "price-summary" ? "bao-gia-camera-rut-gon" : "bao-gia-camera-day-du"}-${String(index + 1).padStart(2, "0")}.png`,
      copiedMessage: mode === "price-summary"
        ? `Đã sao chép ảnh giá gói ${item.model}.`
        : `Đã sao chép ảnh báo giá đầy đủ ${item.model}.`,
      downloadedMessage: "Không thể sao chép; ảnh báo giá đã được tải xuống.",
    });
  }

  function copyMenu(item: Model, index: number, iconOnly: boolean) {
    return (
      <div onClick={(event) => event.stopPropagation()}>
        <LumaActionMenu
          label="Sao chép"
          ariaLabel={`Chọn kiểu sao chép ${item.model}`}
          icon={Copy}
          iconOnly={iconOnly}
          items={[
            {
              key: "camera-only",
              label: "Chỉ thông tin camera",
              icon: ClipboardList,
              onSelect: () => copySpecsImage(item, index),
            },
            {
              key: "price-summary",
              label: "Giá gói rút gọn",
              icon: Copy,
              onSelect: () => copyQuoteImage(item, index, "price-summary"),
            },
            {
              key: "full",
              label: "Báo giá đầy đủ",
              icon: ListChecks,
              onSelect: () => copyQuoteImage(item, index, "full"),
            },
          ]}
          className={
            iconOnly
              ? "inline-flex h-11 w-11 items-center justify-center rounded-lg border border-teal-200 bg-white text-[#0b7b74] transition hover:bg-teal-50"
              : "inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-lg border border-teal-200 bg-white px-3.5 py-2.5 text-sm font-bold text-[#087b74] shadow-[0_2px_8px_rgba(8,129,122,.06)] transition hover:border-teal-300 hover:bg-teal-50"
          }
        />
      </div>
    );
  }

  return (
    <main className="min-h-full bg-slate-100 px-3 py-7 sm:px-6 sm:py-10">
      <div
        className="mx-auto max-w-[1500px] bg-white px-5 pb-10 pt-0 shadow-[0_18px_60px_rgba(15,23,42,.14)] sm:px-10"
        style={{ fontFamily: "Arial, sans-serif" }}
      >
        <div className="-mx-5 flex h-8 bg-[#12364f] sm:-mx-10">
          <div className="w-1/5 bg-[#078a82]" />
        </div>
        <header className="pt-14">
          <h1 className="text-4xl font-black leading-[1.08] tracking-tight text-[#14344d] sm:text-5xl">
            BẢNG GIÁ CAMERA
            <br />
            {brandName}
          </h1>
          <div className="mt-8 flex flex-col gap-2 bg-[#14344d] px-5 py-4 font-bold text-white sm:flex-row sm:items-center sm:justify-between">
            <span className="text-xl">HẢI ĐĂNG TECH</span>
            <span>0868306286 - 0868506286</span>
          </div>
        </header>
        <div className="mt-7 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black uppercase text-[#14344d]">
              Danh sách {filtered.length} camera
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              Mỗi camera có thông số, ảnh sản phẩm và các lựa chọn thẻ nhớ.
            </p>
          </div>
          <label className="relative">
            <Search className="absolute left-3 top-3 h-4 w-4 text-slate-400" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Tìm model..."
              className="w-44 border border-slate-300 py-2 pl-9 pr-3 text-sm outline-none focus:border-[#078a82] min-h-11 lg:min-h-0 min-h-11 lg:min-h-0"
            />
          </label>
        </div>
        <section className="mt-4 space-y-3 md:hidden">
          {filtered.map((item, index) => (
            <article
              key={item.id}
              onClick={() => scrollToPackage(item.id)}
              className="cursor-pointer rounded-xl border border-slate-200 bg-white p-4 shadow-[0_4px_18px_rgba(15,23,42,.04)] transition active:bg-teal-50"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-black leading-5 text-[#14344d]">
                    {item.model}
                  </h3>
                  <p className="mt-1 text-xs font-bold text-[#078a82]">
                    Lắp đặt: {item.installationLocation}
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Phù hợp: {item.suitableFor[0]}
                  </p>
                </div>
                <div className="shrink-0">{copyMenu(item, index, true)}</div>
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
                          className="text-slate-400 hover:text-[#0b7b74] min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
                          aria-label={`Sửa giá ${item.model}`}
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    <p className="mt-1 text-[10px] leading-4 text-slate-500">
                      Lưu liên tục: {variant.storageEstimate}
                    </p>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </section>
        <section className="mt-4 hidden overflow-x-auto border border-slate-300 md:block">
          <table
            className="w-full table-fixed border-collapse text-left text-sm [overflow-wrap:anywhere]"
            style={{ minWidth: Math.max(1080, 640 + 144 * memoryLabels.length) }}
          >
            <colgroup>
              <col className="w-14" />
              <col className="w-72" />
              <col />
              {memoryLabels.map((label) => <col key={label} className="w-36" />)}
              <col className="w-24" />
            </colgroup>
            <thead className="bg-[#0b7b74] text-white">
              <tr>
                <th className="border-r border-white/40 px-3 py-3 text-center">
                  Gói
                </th>
                <th className="border-r border-white/40 px-3 py-3">
                  Model camera
                </th>
                <th className="border-r border-white/40 px-3 py-3">
                  Vị trí lắp đặt
                </th>
                {memoryLabels.map((label) => (
                  <th
                    key={label}
                    className="border-r border-white/40 px-3 py-3 text-right"
                  >
                    {label}
                  </th>
                ))}
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((item, index) => (
                <tr
                  key={item.id}
                  data-testid="camera-price-list-row"
                  onClick={() => scrollToPackage(item.id)}
                  className={`${index % 2 ? "bg-slate-100" : "bg-white"} h-16 cursor-pointer hover:bg-teal-50/60`}
                >
                  <td className="border border-slate-300 px-3 py-3 text-center text-slate-600">
                    {String(index + 1).padStart(2, "0")}
                  </td>
                  <td className="border border-slate-300 px-3 py-3 font-bold text-[#14344d]">
                    {item.model}
                  </td>
                  <td className="border border-slate-300 px-3 py-3 leading-5 text-slate-600">
                    {item.installationLocation}
                  </td>
                  {memoryLabels.map((label, variantIndex) => {
                    const variant = item.variants[variantIndex];
                    return (
                      <td
                        key={label}
                        className="border border-slate-300 p-0 text-[#14344d]"
                      >
                        {variant &&
                          (canEdit ? (
                            <button
                              type="button"
                              data-testid="camera-price-edit-cell"
                              onClick={(event) => {
                                event.stopPropagation();
                                openPriceEditor(item, variant, label, "price");
                              }}
                              className="group flex min-h-16 w-full min-w-0 items-center justify-end gap-2 px-3 py-3 text-right font-extrabold transition hover:bg-teal-100/70 focus-visible:outline-2 focus-visible:outline-[#0b7b74]"
                              aria-label={`Sửa giá ${item.model} · ${label}`}
                            >
                              <span className="min-w-0">{formatCurrency(variant.price)}</span>
                              <Edit3 className="h-3.5 w-3.5 shrink-0 text-slate-400 transition group-hover:text-[#0b7b74]" />
                            </button>
                          ) : (
                            <span className="block px-3 py-3 text-right font-extrabold">
                              {formatCurrency(variant.price)}
                            </span>
                          ))}
                      </td>
                    );
                  })}
                  <td className="border border-slate-300 px-1 text-center">
                    <div className="flex items-center justify-center">
                      {copyMenu(item, index, true)}
                    </div>
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
                    </div>
                    {copyMenu(item, index, false)}
                  </div>
                  <div
                    data-testid="camera-package-total-prices"
                    className="mt-6 grid gap-2 sm:grid-cols-2"
                  >
                    {item.variants.map((variant, variantIndex) => (
                      <div
                        key={variant.id}
                        className="rounded-xl border border-teal-100 bg-[#edf7f7] px-4 py-3.5 shadow-[inset_0_1px_0_rgba(255,255,255,.7)]"
                      >
                        <p className="text-sm font-bold text-slate-500">
                          {memoryLabels[variantIndex] ??
                            `Gói ${variantIndex + 1}`}
                        </p>
                        <div className="mt-1 flex items-center justify-between gap-2">
                          <p className="text-xl font-black text-[#007e78]">
                            {formatCurrency(variant.price)}
                          </p>
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() =>
                                openPriceEditor(
                                  item,
                                  variant,
                                  memoryLabels[variantIndex] ?? `Gói ${variantIndex + 1}`,
                                  "price",
                                )
                              }
                              className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-400 transition hover:bg-white hover:text-[#0b7b74]"
                              aria-label={`Sửa tổng giá ${memoryLabels[variantIndex] ?? `Gói ${variantIndex + 1}`}`}
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                          )}
                        </div>
                        <p className="mt-1 text-xs text-slate-500">
                          Ghi liên tục: {variant.storageEstimate}
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
                  <div className="mt-5">
                    <section className="rounded-xl border border-teal-100 bg-teal-50/50 p-4">
                      <h4 className="text-sm font-black text-[#0b7b74]">PHÙ HỢP CHO</h4>
                      <ul className="mt-2 space-y-1 text-sm leading-5 text-slate-700">
                        {item.suitableFor.map((recommendation) => <li key={recommendation}>• {recommendation}</li>)}
                      </ul>
                    </section>
                  </div>
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
                                    className="shrink-0 text-slate-400 hover:text-[#0b7b74] min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
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
                  <table className="mt-6 hidden w-full table-fixed border-collapse text-sm [overflow-wrap:anywhere] sm:table">
                    <colgroup>
                      <col className="w-40" />
                      {item.variants.map((variant) => <col key={variant.id} />)}
                    </colgroup>
                    <thead className="bg-[#07817a] text-white">
                      <tr>
                        <th className="border border-white/40 px-3 py-2 text-left">
                          Hạng mục
                        </th>
                        {item.variants.map((_, variantIndex) => (
                          <th
                            key={memoryLabels[variantIndex] ?? variantIndex}
                            className="border border-white/40 px-3 py-2 text-right"
                          >
                            {memoryLabels[variantIndex] ?? `Thẻ nhớ ${variantIndex + 1}`}
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
                                  className="ml-2 align-middle text-slate-400 hover:text-[#0b7b74] min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
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
                    Thẻ nhớ chuyên dụng cho camera. Thời gian lưu là ước tính khi ghi liên tục;
                    thực tế thay đổi theo cài đặt, cảnh chuyển động và chất lượng mạng.
                  </p>
                  <p className="mt-2 text-xs text-slate-500">
                    Lưu ý: Chi phí có thể phát sinh theo thực tế (đi dây, vật tư bổ sung hoặc vị
                    trí lắp đặt khó); sẽ được báo trước khi thực hiện.
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
      {notice && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-5 right-5 z-[60] max-w-[calc(100vw-2.5rem)] rounded-xl bg-[#14344d] px-4 py-3 text-sm font-bold text-white shadow-xl"
        >
          {notice}
        </div>
      )}
      {editing && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/45 p-4">
          <div className="w-full max-w-sm bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between">
              <h2 className="font-black text-[#14344d]">Sửa giá tạm thời</h2>
              <button className="min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0" onClick={() => setEditing(null)}>
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
                className="px-3 py-2 text-sm font-semibold min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
              >
                Hủy
              </button>
              <button
                onClick={applyPrice}
                className="bg-[#0b7b74] px-3 py-2 text-sm font-semibold text-white min-h-11 lg:min-h-0 min-w-11 lg:min-w-0 min-h-11 lg:min-h-0 min-w-11 lg:min-w-0"
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
