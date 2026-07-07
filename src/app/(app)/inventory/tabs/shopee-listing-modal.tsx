"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Check, Loader2, Sparkles, UploadCloud, X } from "lucide-react";
import { generateShopeeListingAiFill, publishShopeeListing, saveShopeeListingDraft } from "@/lib/actions/marketplace";
import type { ProductDetail } from "@/lib/data/products";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";

type FormState = {
  title: string;
  shortDescription: string;
  description: string;
  categoryId: string;
  categoryPath: string;
  brand: string;
  sku: string;
  barcode: string;
  price: number;
  compareAtPrice: number;
  stock: number;
  weight: number;
  dimensions: string;
  imageUrls: string;
  videoUrl: string;
  syncMode: "luma_to_shopee" | "shopee_to_luma" | "manual";
  minStockThreshold: number;
  outOfStockBehavior: "keep_visible" | "unlist" | "set_zero";
};

const FIELD = "w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20";
const LABEL = "text-[10px] font-bold uppercase tracking-wide text-slate-500";
const PROVIDERS = ["Shopee", "TikTok Shop", "Lazada", "Tiki"] as const;

export function ShopeeListingModal({ product, closeHref }: { product: ProductDetail; closeHref: string }) {
  const locale = useLocale();
  const L = locale === "vi";
  const router = useRouter();
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [aiSuggestionId, setAiSuggestionId] = useState<string | undefined>();
  const [editedFields, setEditedFields] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>({
    title: product.name.slice(0, 120),
    shortDescription: product.description?.slice(0, 300) ?? "",
    description: product.description || `${product.name}\nSKU: ${product.sku}`,
    categoryId: "",
    categoryPath: product.categoryName ?? "",
    brand: product.brandName ?? "",
    sku: product.sku,
    barcode: product.barcode ?? "",
    price: Number(product.retailPrice),
    compareAtPrice: 0,
    stock: Number(product.totalStock),
    weight: product.weight ? Number(product.weight) : 0,
    dimensions: product.dimensions ?? "",
    imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls.join("\n") : "",
    videoUrl: "",
    syncMode: "luma_to_shopee",
    minStockThreshold: 0,
    outOfStockBehavior: "keep_visible",
  });
  const images = useMemo(() => form.imageUrls.split(/\n|,/).map((x) => x.trim()).filter(Boolean), [form.imageUrls]);
  const canPublish = form.title.trim().length > 0 && form.description.trim().length >= 20 && form.price >= 0 && form.stock >= 0;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setEditedFields((prev) => prev.includes(key) ? prev : [...prev, key]);
    setMessage("");
    setError("");
  }

  function payload(action: "draft" | "publish" | "update") {
    return {
      productId: product.id,
      action,
      region: "VN",
      categoryId: form.categoryId,
      categoryPath: form.categoryPath,
      brand: form.brand,
      title: form.title,
      shortDescription: form.shortDescription,
      description: form.description,
      condition: "NEW" as const,
      status: action === "draft" ? "draft" as const : "ready" as const,
      sku: form.sku,
      barcode: form.barcode,
      price: Number(form.price) || 0,
      compareAtPrice: Number(form.compareAtPrice) || undefined,
      stock: Number(form.stock) || 0,
      weight: Number(form.weight) || undefined,
      dimensions: form.dimensions,
      imageUrls: images,
      videoUrl: form.videoUrl,
      attributes: { brand: form.brand, categoryPath: form.categoryPath },
      variants: product.children.map((child) => ({
        name: child.variantName || child.name,
        sku: child.sku,
        barcode: child.barcode || "",
        price: Number(child.retailPrice),
        stock: Number(child.totalStock),
        imageUrls: Array.isArray(child.imageUrls) ? child.imageUrls : [],
      })),
      syncMode: form.syncMode,
      minStockThreshold: Number(form.minStockThreshold) || 0,
      outOfStockBehavior: form.outOfStockBehavior,
      aiSuggestionId,
      editedFields,
    };
  }

  function autoFill() {
    setError("");
    setMessage("");
    startAi(async () => {
      const res = await generateShopeeListingAiFill({ productId: product.id, preserve: Object.fromEntries(editedFields.map((key) => [key, form[key as keyof FormState]])) });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const data = res.data;
      setAiSuggestionId(typeof data.aiSuggestionId === "string" ? data.aiSuggestionId : undefined);
      setForm((prev) => ({
        ...prev,
        title: typeof data.title === "string" ? data.title.slice(0, 120) : prev.title,
        shortDescription: typeof data.shortDescription === "string" ? data.shortDescription : prev.shortDescription,
        description: typeof data.description === "string" ? data.description : prev.description,
        categoryId: typeof (data.category as { id?: unknown } | undefined)?.id === "string" ? (data.category as { id: string }).id : prev.categoryId,
        categoryPath: typeof (data.category as { path?: unknown } | undefined)?.path === "string" ? (data.category as { path: string }).path : prev.categoryPath,
        price: typeof data.price === "number" ? data.price : prev.price,
        stock: typeof data.stock === "number" ? data.stock : prev.stock,
        weight: typeof data.weight === "number" ? data.weight : prev.weight,
      }));
      setMessage(L ? "AI đã điền gợi ý. Kiểm tra lại trước khi publish." : "AI filled a draft. Review before publishing.");
    });
  }

  function save(action: "draft" | "publish") {
    setError("");
    setMessage("");
    start(async () => {
      const res = action === "publish"
        ? await publishShopeeListing(payload("publish"))
        : await saveShopeeListingDraft(payload("draft"));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setMessage(action === "publish" ? (L ? "Đã queue publish listing lên kênh online." : "Online listing publish queued.") : (L ? "Đã lưu draft listing online." : "Online listing draft saved."));
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-2 sm:p-5">
      <div className="flex h-[min(94dvh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-primary-600">{L ? "Đăng sàn" : "List online"}</div>
            <h2 className="truncate text-lg font-extrabold">{product.name}</h2>
          </div>
          <Link href={closeHref} className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-surface-2" aria-label="Close">
            <X className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[280px_1fr]">
          <aside className="border-b border-border bg-canvas p-4 lg:border-b-0 lg:border-r">
            <div className="relative h-52 overflow-hidden rounded-card border border-border bg-surface">
              {images[0] ? <Image src={images[0]} alt={product.name} fill className="object-cover" unoptimized /> : <div className="grid h-full place-items-center text-slate-400"><UploadCloud className="h-9 w-9" /></div>}
            </div>
            <div className="mt-3 space-y-2 text-sm">
              <Info label="SKU" value={product.sku} />
              <Info label={L ? "Giá Luma" : "Luma price"} value={formatCurrency(Number(product.retailPrice))} />
              <Info label={L ? "Tồn" : "Stock"} value={`${formatNumber(Number(product.totalStock))} ${product.baseUnit}`} />
              <Info label={L ? "Danh mục" : "Category"} value={product.categoryName ?? "—"} />
              <Info label={L ? "Biến thể" : "Variants"} value={String(product.children.length)} />
            </div>
          </aside>

          <main className="space-y-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex w-full flex-wrap gap-2">
                {PROVIDERS.map((provider) => (
                  <button
                    key={provider}
                    type="button"
                    disabled={provider !== "Shopee"}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-bold",
                      provider === "Shopee"
                        ? "border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-950/40"
                        : "border-border bg-surface-2 text-slate-400",
                    )}
                  >
                    {provider}{provider !== "Shopee" ? ` · ${L ? "sắp hỗ trợ" : "soon"}` : ""}
                  </button>
                ))}
              </div>
              <button type="button" disabled={aiPending} onClick={autoFill} className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {L ? "Auto fill bằng AI" : "Auto fill with AI"}
              </button>
              <span className="text-xs text-slate-500">{L ? "AI không tự publish; mọi field đều sửa được." : "AI never publishes; every field remains editable."}</span>
            </div>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              <Field label={L ? "Tiêu đề listing" : "Listing title"}><input className={FIELD} value={form.title} maxLength={120} onChange={(e) => set("title", e.target.value)} /></Field>
              <Field label={L ? "Danh mục theo kênh" : "Channel category"}><input className={FIELD} value={form.categoryPath} onChange={(e) => set("categoryPath", e.target.value)} placeholder={L ? "Ví dụ: Nhà cửa > Vật liệu xây dựng" : "Example: Home > Building materials"} /></Field>
              <Field label={L ? "Brand" : "Brand"}><input className={FIELD} value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
              <Field label="SKU"><input className={FIELD} value={form.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
              <Field label={L ? "Giá bán" : "Price"}><input className={FIELD} type="number" min={0} value={form.price} onChange={(e) => set("price", Number(e.target.value))} /></Field>
              <Field label={L ? "Tồn đăng sàn" : "Channel stock"}><input className={FIELD} type="number" min={0} value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} /></Field>
              <Field label={L ? "Khối lượng" : "Weight"}><input className={FIELD} type="number" min={0} value={form.weight} onChange={(e) => set("weight", Number(e.target.value))} /></Field>
              <Field label={L ? "Kích thước" : "Dimensions"}><input className={FIELD} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} /></Field>
            </div>

            <Field label={L ? "Mô tả ngắn" : "Short description"}><textarea className={cn(FIELD, "min-h-20")} value={form.shortDescription} onChange={(e) => set("shortDescription", e.target.value)} /></Field>
            <Field label={L ? "Mô tả đầy đủ" : "Full description"}><textarea className={cn(FIELD, "min-h-44")} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
            <Field label={L ? "Ảnh sản phẩm (mỗi dòng một URL)" : "Product images (one URL per line)"}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} value={form.imageUrls} onChange={(e) => set("imageUrls", e.target.value)} /></Field>

            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <Field label={L ? "Sync mode" : "Sync mode"}>
                <select className={FIELD} value={form.syncMode} onChange={(e) => set("syncMode", e.target.value as FormState["syncMode"])}>
                  <option value="luma_to_shopee">{L ? "Luma → Kênh online" : "Luma → Online channel"}</option>
                  <option value="shopee_to_luma">{L ? "Kênh online → Luma" : "Online channel → Luma"}</option>
                  <option value="manual">Manual</option>
                </select>
              </Field>
              <Field label={L ? "Ngưỡng tồn thấp" : "Min stock threshold"}><input className={FIELD} type="number" min={0} value={form.minStockThreshold} onChange={(e) => set("minStockThreshold", Number(e.target.value))} /></Field>
              <Field label={L ? "Khi hết hàng" : "Out of stock"}>
                <select className={FIELD} value={form.outOfStockBehavior} onChange={(e) => set("outOfStockBehavior", e.target.value as FormState["outOfStockBehavior"])}>
                  <option value="keep_visible">{L ? "Giữ hiển thị" : "Keep visible"}</option>
                  <option value="unlist">{L ? "Ẩn listing" : "Unlist"}</option>
                  <option value="set_zero">{L ? "Set tồn = 0" : "Set zero"}</option>
                </select>
              </Field>
            </div>

            {product.children.length > 0 && (
              <div className="rounded-card border border-border px-4 py-3">
                <div className={LABEL}>{L ? "Biến thể sẽ được map sang model của kênh" : "Variants mapped to channel models"}</div>
                <div className="mt-2 grid gap-2">
                  {product.children.map((child) => (
                    <div key={child.id} className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-lg bg-canvas px-3 py-2 text-sm">
                      <span className="truncate font-medium">{child.variantName || child.name}</span>
                      <span className="tabular-nums">{formatCurrency(Number(child.retailPrice))}</span>
                      <span className="tabular-nums text-slate-500">{formatNumber(Number(child.totalStock))}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(message || error) && <div className={cn("rounded-card px-4 py-3 text-sm font-semibold", error ? "bg-er-soft text-er" : "bg-ok-soft text-ok")}>{error || message}</div>}
          </main>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <span className="text-xs text-slate-500">{L ? "Publish sẽ tạo sync job và lưu payload/response để retry." : "Publish creates a sync job and stores payload/response for retry."}</span>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => save("draft")} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {L ? "Lưu draft" : "Save draft"}
            </button>
            <button type="button" disabled={pending || !canPublish} onClick={() => save("publish")} className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
              {L ? "Publish lên sàn" : "Publish online"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="flex flex-col gap-1"><span className={LABEL}>{label}</span>{children}</label>;
}

function Info({ label, value }: { label: string; value: string }) {
  return <div className="flex items-center justify-between gap-3"><span className="text-slate-500">{label}</span><span className="truncate font-semibold">{value}</span></div>;
}
