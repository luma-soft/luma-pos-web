"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Check, Loader2, Search, Sparkles, UploadCloud, X } from "lucide-react";
import { generateShopeeListingAiFill, publishShopeeListing, saveShopeeListingDraft } from "@/lib/actions/marketplace";
import { searchPosProducts } from "@/lib/actions/pos-search";
import type { ProductDetail } from "@/lib/data/products";
import type { PosProduct } from "@/lib/data/pos";
import { MoneyInput } from "@/components/ui/money-input";
import { Select } from "@/components/ui/select";
import { categoryEmoji } from "@/lib/category-emoji";
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
const PROVIDERS = [
  { id: "shopee", name: "Shopee", ready: true },
  { id: "tiktok_shop", name: "TikTok Shop", ready: false },
  { id: "lazada", name: "Lazada", ready: false },
  { id: "tiki", name: "Tiki", ready: false },
] as const;
type ProviderId = (typeof PROVIDERS)[number]["id"];

export function ShopeeListingModal({ product, closeHref }: { product: ProductDetail | null; closeHref: string }) {
  const locale = useLocale();
  const L = locale === "vi";
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [pending, start] = useTransition();
  const [aiPending, startAi] = useTransition();
  const [provider, setProvider] = useState<ProviderId>("shopee");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [aiSuggestionId, setAiSuggestionId] = useState<string | undefined>();
  const [editedFields, setEditedFields] = useState<string[]>([]);
  const [form, setForm] = useState<FormState>(() => formFromProduct(product));

  const images = useMemo(() => form.imageUrls.split(/\n|,/).map((x) => x.trim()).filter(Boolean), [form.imageUrls]);
  const canPublish = Boolean(product) && provider === "shopee" && form.title.trim().length > 0 && form.description.trim().length >= 20 && form.price >= 0 && form.stock >= 0;

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((prev) => ({ ...prev, [key]: value }));
    setEditedFields((prev) => prev.includes(key) ? prev : [...prev, key]);
    setMessage("");
    setError("");
  }

  function payload(action: "draft" | "publish" | "update") {
    if (!product) throw new Error("Product is required");
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
    if (!product || provider !== "shopee") return;
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
    if (!product || provider !== "shopee") {
      setError(L ? "Chọn sản phẩm và kênh Shopee trước khi lưu." : "Select a product and Shopee before saving.");
      return;
    }
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
            <h2 className="truncate text-lg font-extrabold">{product ? product.name : (L ? "Tạo listing bán online" : "Create online listing")}</h2>
          </div>
          <Link href={closeHref} className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-surface-2" aria-label="Close">
            <X className="h-4 w-4" />
          </Link>
        </div>

        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[280px_1fr]">
          <aside className="border-b border-border bg-canvas p-4 lg:border-b-0 lg:border-r">
            <div className="relative h-52 overflow-hidden rounded-card border border-border bg-surface">
              {images[0] && product ? <Image src={images[0]} alt={product.name} fill className="object-cover" unoptimized /> : <div className="grid h-full place-items-center text-slate-400"><UploadCloud className="h-9 w-9" /></div>}
            </div>
            <div className="mt-3 space-y-2 text-sm">
              {product ? (
                <>
                  <Info label="SKU" value={product.sku} />
                  <Info label={L ? "Giá nhập" : "Cost price"} value={formatCurrency(Number(product.costPrice))} />
                  <Info label={L ? "Giá Luma" : "Luma price"} value={formatCurrency(Number(product.retailPrice))} />
                  <Info label={L ? "Tồn" : "Stock"} value={`${formatNumber(Number(product.totalStock))} ${product.baseUnit}`} />
                  <Info label={L ? "Danh mục" : "Category"} value={product.categoryName ?? "—"} />
                  <Info label={L ? "Biến thể" : "Variants"} value={String(product.children.length)} />
                </>
              ) : (
                <p className="text-sm text-slate-500">{L ? "Tìm và chọn sản phẩm để bắt đầu điền thông tin đăng bán." : "Search and select a product to start filling listing details."}</p>
              )}
            </div>
          </aside>

          <main className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_220px]">
              <ProductSearchInListing
                L={L}
                selectedProduct={product}
                onSelect={(productId) => {
                  const sp = new URLSearchParams(searchParams.toString());
                  sp.set("onlineListing", "1");
                  sp.set("onlineProductId", productId);
                  router.replace(`${pathname}?${sp.toString()}`, { scroll: false });
                }}
              />
              <label className="flex flex-col gap-1">
                <span className={LABEL}>{L ? "Kênh bán" : "Sales channel"}</span>
                <Select
                  value={provider}
                  onValueChange={(value) => setProvider(value as ProviderId)}
                  options={PROVIDERS.map((item) => ({
                    value: item.id,
                    label: `${item.name}${item.ready ? "" : ` · ${L ? "sắp hỗ trợ" : "soon"}`}`,
                  }))}
                  className="w-full"
                />
              </label>
            </div>

            {!product ? (
              <div className="rounded-card border border-dashed border-border bg-canvas px-4 py-10 text-center text-sm text-slate-400">
                {L ? "Chọn sản phẩm ở ô tìm kiếm để mở form theo từng sàn." : "Select a product from search to open the marketplace-specific form."}
              </div>
            ) : (
              <>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={aiPending || provider !== "shopee"} onClick={autoFill} className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50">
                {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {L ? "Auto fill bằng AI" : "Auto fill with AI"}
              </button>
              <span className="text-xs text-slate-500">
                {provider === "shopee"
                  ? (L ? "AI không tự publish; mọi field đều sửa được." : "AI never publishes; every field remains editable.")
                  : (L ? "AI/publish sẽ bật khi adapter sàn này sẵn sàng." : "AI/publish unlocks when this marketplace adapter is ready.")}
              </span>
            </div>

            <PricingRecommendation
              L={L}
              provider={provider}
              costPrice={Number(product.costPrice)}
              currentPrice={form.price}
              onUse={(price) => set("price", price)}
            />

            <ProviderListingFields provider={provider} form={form} set={set} L={L} />

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
              </>
            )}
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

function PricingRecommendation({
  L,
  provider,
  costPrice,
  currentPrice,
  onUse,
}: {
  L: boolean;
  provider: ProviderId;
  costPrice: number;
  currentPrice: number;
  onUse: (price: number) => void;
}) {
  const assumption = MARKETPLACE_PRICE_ASSUMPTIONS[provider];
  const targetMarginRate = 0.2;
  const suggestedPrice = suggestMarketplacePrice(costPrice, assumption.percentFee, assumption.fixedFee, targetMarginRate);
  const feeAmount = currentPrice > 0 ? Math.round(currentPrice * assumption.percentFee + assumption.fixedFee) : 0;
  const currentProfit = currentPrice > 0 ? Math.round(currentPrice - feeAmount - costPrice) : 0;
  const currentMargin = currentPrice > 0 ? currentProfit / currentPrice : 0;
  const canSuggest = costPrice > 0 && suggestedPrice > 0;

  return (
    <section className="rounded-card border border-primary-100 bg-primary-50/60 px-4 py-3 dark:border-primary-900 dark:bg-primary-950/20">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1fr_auto] lg:items-center">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wide text-primary-700 dark:text-primary-300">
            {L ? "Gợi ý giá bán" : "Suggested selling price"}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-4">
            <PriceMetric label={L ? "Giá nhập" : "Cost"} value={costPrice > 0 ? formatCurrency(costPrice) : "—"} />
            <PriceMetric label={L ? "Phí tạm tính" : "Fee estimate"} value={`${Math.round(assumption.percentFee * 1000) / 10}%${assumption.fixedFee ? ` + ${formatCurrency(assumption.fixedFee)}` : ""}`} />
            <PriceMetric label={L ? "Margin mục tiêu" : "Target margin"} value={`${Math.round(targetMarginRate * 100)}%`} />
            <PriceMetric label={L ? "Lãi giá hiện tại" : "Current profit"} value={currentPrice > 0 ? `${formatCurrency(currentProfit)} (${Math.round(currentMargin * 100)}%)` : "—"} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {L
              ? `Tạm tính theo biểu phí ${assumption.label}; phí thực tế thay đổi theo ngành hàng, chương trình và loại shop.`
              : `Estimated using ${assumption.label}; actual fees vary by category, campaign, and shop type.`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{L ? "Giá đề xuất" : "Suggested price"}</div>
            <div className="text-lg font-extrabold tabular-nums text-primary-700 dark:text-primary-300">{canSuggest ? formatCurrency(suggestedPrice) : "—"}</div>
          </div>
          <button
            type="button"
            disabled={!canSuggest}
            onClick={() => onUse(suggestedPrice)}
            className="rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50"
          >
            {L ? "Dùng giá này" : "Use price"}
          </button>
        </div>
      </div>
    </section>
  );
}

function PriceMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-bold text-slate-500">{label}</div>
      <div className="mt-0.5 font-semibold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
    </div>
  );
}

const MARKETPLACE_PRICE_ASSUMPTIONS: Record<ProviderId, { label: string; percentFee: number; fixedFee: number }> = {
  shopee: { label: "Shopee: fixed/category fee + transaction fee", percentFee: 0.14, fixedFee: 3000 },
  tiktok_shop: { label: "TikTok Shop: platform commission + transaction fee", percentFee: 0.185, fixedFee: 0 },
  lazada: { label: "Lazada: commission + processing fee", percentFee: 0.14, fixedFee: 3000 },
  tiki: { label: "Tiki: category commission/service estimate", percentFee: 0.12, fixedFee: 0 },
};

function suggestMarketplacePrice(costPrice: number, percentFee: number, fixedFee: number, targetMarginRate: number) {
  if (!Number.isFinite(costPrice) || costPrice <= 0) return 0;
  const denominator = 1 - percentFee - targetMarginRate;
  if (denominator <= 0) return 0;
  return roundUpTo(costPrice + fixedFee, denominator, 1000);
}

function roundUpTo(baseCost: number, denominator: number, step: number) {
  return Math.ceil((baseCost / denominator) / step) * step;
}

function ProviderListingFields({
  provider,
  form,
  set,
  L,
}: {
  provider: ProviderId;
  form: FormState;
  set: <K extends keyof FormState>(key: K, value: FormState[K]) => void;
  L: boolean;
}) {
  if (provider === "tiktok_shop") return <TikTokListingFields form={form} set={set} L={L} />;
  if (provider === "lazada") return <LazadaListingFields form={form} set={set} L={L} />;
  if (provider === "tiki") return <TikiListingFields form={form} set={set} L={L} />;
  return <ShopeeListingFields form={form} set={set} L={L} />;
}

function ShopeeListingFields({ form, set, L }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; L: boolean }) {
  return (
    <>
      <FormSection title={L ? "Shopee product" : "Shopee product"} note={L ? "Cần category_id, brand/attributes theo danh mục, ảnh đã upload sang Shopee, logistics và package." : "Requires category_id, category brand/attributes, Shopee-uploaded media, logistics, and package data."}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={L ? "Tên sản phẩm Shopee" : "Shopee item name"}><input className={FIELD} value={form.title} maxLength={120} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label={L ? "Shopee category_id / path" : "Shopee category_id / path"}><input className={FIELD} value={form.categoryPath} onChange={(e) => set("categoryPath", e.target.value)} placeholder={L ? "ID hoặc path từ Shopee category API" : "ID or path from Shopee category API"} /></Field>
          <Field label={L ? "Shopee brand_id / brand" : "Shopee brand_id / brand"}><input className={FIELD} value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
          <Field label="Seller SKU"><input className={FIELD} value={form.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          <Field label={L ? "Giá bán" : "Price"}><MoneyInput className={FIELD} value={form.price} min={0} onChange={(value) => set("price", value ?? 0)} /></Field>
          <Field label={L ? "Normal stock" : "Normal stock"}><input className={FIELD} type="number" min={0} value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} /></Field>
        </div>
      </FormSection>

      <FormSection title={L ? "Media, vận chuyển & thuộc tính" : "Media, logistics & attributes"} note={L ? "Ảnh cần chuyển thành image_id_list, logistic_info cần lấy từ shop logistics." : "Images should become image_id_list; logistic_info should come from shop logistics."}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={L ? "Ảnh / image_id_list" : "Images / image_id_list"}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} value={form.imageUrls} onChange={(e) => set("imageUrls", e.target.value)} /></Field>
          <Field label={L ? "Mô tả Shopee" : "Shopee description"}><textarea className={cn(FIELD, "min-h-24")} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label={L ? "Khối lượng gói hàng (kg)" : "Package weight (kg)"}><input className={FIELD} type="number" min={0} value={form.weight} onChange={(e) => set("weight", Number(e.target.value))} /></Field>
          <Field label={L ? "Kích thước D x R x C (cm)" : "Dimensions L x W x H (cm)"}><input className={FIELD} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} placeholder="20 x 10 x 8" /></Field>
          <Field label={L ? "Logistic IDs" : "Logistic IDs"}><input className={FIELD} placeholder={L ? "VD: 5001, 5002" : "Example: 5001, 5002"} /></Field>
          <Field label={L ? "Attributes theo danh mục" : "Category attributes"}><textarea className={cn(FIELD, "min-h-20 font-mono text-xs")} value={`brand=${form.brand}\ncategoryPath=${form.categoryPath}`} readOnly /></Field>
        </div>
      </FormSection>
      <SyncFields form={form} set={set} L={L} />
    </>
  );
}

function TikTokListingFields({ form, set, L }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; L: boolean }) {
  return (
    <>
      <FormSection title="TikTok Shop" note={L ? "TikTok cần category, attributes, description dạng HTML, media upload, package, SKU/inventory và có thể cần certification." : "TikTok needs category, attributes, HTML description, uploaded media, package data, SKU/inventory, and possibly certifications."}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={L ? "Product title" : "Product title"}><input className={FIELD} value={form.title} maxLength={255} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label={L ? "TikTok category" : "TikTok category"}><input className={FIELD} value={form.categoryPath} onChange={(e) => set("categoryPath", e.target.value)} /></Field>
          <Field label={L ? "Brand" : "Brand"}><input className={FIELD} value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
          <Field label="Seller SKU"><input className={FIELD} value={form.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          <Field label={L ? "Giá SKU" : "SKU price"}><MoneyInput className={FIELD} value={form.price} min={0} onChange={(value) => set("price", value ?? 0)} /></Field>
          <Field label={L ? "Warehouse inventory" : "Warehouse inventory"}><input className={FIELD} type="number" min={0} value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} /></Field>
          <Field label={L ? "Package weight" : "Package weight"}><input className={FIELD} type="number" min={0} value={form.weight} onChange={(e) => set("weight", Number(e.target.value))} /></Field>
          <Field label={L ? "Package dimensions" : "Package dimensions"}><input className={FIELD} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} /></Field>
        </div>
        <Field label={L ? "Description HTML" : "HTML description"}><textarea className={cn(FIELD, "min-h-32")} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label={L ? "Images/video/certification assets" : "Images/video/certification assets"}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} value={form.imageUrls} onChange={(e) => set("imageUrls", e.target.value)} /></Field>
      </FormSection>
      <AdapterPending provider="TikTok Shop" L={L} />
    </>
  );
}

function LazadaListingFields({ form, set, L }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; L: boolean }) {
  return (
    <>
      <FormSection title="Lazada" note={L ? "Lazada create product dùng primary category, SPU/SKU attributes, SellerSku, package, quantity, price và images." : "Lazada create product uses primary category, SPU/SKU attributes, SellerSku, package, quantity, price, and images."}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={L ? "Primary category" : "Primary category"}><input className={FIELD} value={form.categoryPath} onChange={(e) => set("categoryPath", e.target.value)} /></Field>
          <Field label={L ? "Product name" : "Product name"}><input className={FIELD} value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label={L ? "Brand" : "Brand"}><input className={FIELD} value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
          <Field label={L ? "Model" : "Model"}><input className={FIELD} placeholder={L ? "Model hoặc dòng sản phẩm" : "Model or product line"} /></Field>
          <Field label="SellerSku"><input className={FIELD} value={form.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          <Field label={L ? "Quantity" : "Quantity"}><input className={FIELD} type="number" min={0} value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} /></Field>
          <Field label={L ? "Price" : "Price"}><MoneyInput className={FIELD} value={form.price} min={0} onChange={(value) => set("price", value ?? 0)} /></Field>
          <Field label={L ? "Special price" : "Special price"}><MoneyInput className={FIELD} value={form.compareAtPrice} min={0} onChange={(value) => set("compareAtPrice", value ?? 0)} /></Field>
          <Field label={L ? "Package weight" : "Package weight"}><input className={FIELD} type="number" min={0} value={form.weight} onChange={(e) => set("weight", Number(e.target.value))} /></Field>
          <Field label={L ? "Package dimensions" : "Package dimensions"}><input className={FIELD} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} /></Field>
        </div>
        <Field label={L ? "Description" : "Description"}><textarea className={cn(FIELD, "min-h-32")} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label={L ? "Images" : "Images"}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} value={form.imageUrls} onChange={(e) => set("imageUrls", e.target.value)} /></Field>
      </FormSection>
      <AdapterPending provider="Lazada" L={L} />
    </>
  );
}

function TikiListingFields({ form, set, L }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; L: boolean }) {
  return (
    <>
      <FormSection title="Tiki" note={L ? "Tiki flow cần chọn category, lấy attribute theo category, map attribute, chuẩn bị certificate files nếu category/brand yêu cầu." : "Tiki flow needs category selection, category attributes, attribute mapping, and certificate files when category/brand requires them."}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={L ? "Tiki category" : "Tiki category"}><input className={FIELD} value={form.categoryPath} onChange={(e) => set("categoryPath", e.target.value)} /></Field>
          <Field label={L ? "Tên sản phẩm" : "Product name"}><input className={FIELD} value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label={L ? "Brand" : "Brand"}><input className={FIELD} value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
          <Field label="Seller SKU"><input className={FIELD} value={form.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          <Field label={L ? "Giá" : "Price"}><MoneyInput className={FIELD} value={form.price} min={0} onChange={(value) => set("price", value ?? 0)} /></Field>
          <Field label={L ? "Tồn" : "Inventory"}><input className={FIELD} type="number" min={0} value={form.stock} onChange={(e) => set("stock", Number(e.target.value))} /></Field>
          <Field label={L ? "Khối lượng" : "Weight"}><input className={FIELD} type="number" min={0} value={form.weight} onChange={(e) => set("weight", Number(e.target.value))} /></Field>
          <Field label={L ? "Kích thước" : "Dimensions"}><input className={FIELD} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} /></Field>
        </div>
        <Field label={L ? "Mô tả" : "Description"}><textarea className={cn(FIELD, "min-h-32")} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label={L ? "Attribute mapping / certificate files" : "Attribute mapping / certificate files"}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} placeholder={L ? "Điền attribute bắt buộc và file chứng nhận nếu Tiki yêu cầu" : "Enter required attributes and certificate files if Tiki requires them"} /></Field>
        <Field label={L ? "Images" : "Images"}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} value={form.imageUrls} onChange={(e) => set("imageUrls", e.target.value)} /></Field>
      </FormSection>
      <AdapterPending provider="Tiki" L={L} />
    </>
  );
}

function SyncFields({ form, set, L }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; L: boolean }) {
  return (
    <FormSection title={L ? "Chính sách đồng bộ" : "Sync policy"}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label={L ? "Sync mode" : "Sync mode"}>
          <Select
            value={form.syncMode}
            onValueChange={(value) => set("syncMode", value as FormState["syncMode"])}
            options={[
              { value: "luma_to_shopee", label: L ? "Luma → Kênh online" : "Luma → Online channel" },
              { value: "shopee_to_luma", label: L ? "Kênh online → Luma" : "Online channel → Luma" },
              { value: "manual", label: "Manual" },
            ]}
            className="w-full"
          />
        </Field>
        <Field label={L ? "Ngưỡng tồn thấp" : "Min stock threshold"}><input className={FIELD} type="number" min={0} value={form.minStockThreshold} onChange={(e) => set("minStockThreshold", Number(e.target.value))} /></Field>
        <Field label={L ? "Khi hết hàng" : "Out of stock"}>
          <Select
            value={form.outOfStockBehavior}
            onValueChange={(value) => set("outOfStockBehavior", value as FormState["outOfStockBehavior"])}
            options={[
              { value: "keep_visible", label: L ? "Giữ hiển thị" : "Keep visible" },
              { value: "unlist", label: L ? "Ẩn listing" : "Unlist" },
              { value: "set_zero", label: L ? "Set tồn = 0" : "Set zero" },
            ]}
            className="w-full"
          />
        </Field>
      </div>
    </FormSection>
  );
}

function FormSection({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-card border border-border-soft bg-surface px-4 py-3">
      <div>
        <h3 className="text-sm font-extrabold">{title}</h3>
        {note && <p className="mt-1 text-xs text-slate-500">{note}</p>}
      </div>
      {children}
    </section>
  );
}

function AdapterPending({ provider, L }: { provider: string; L: boolean }) {
  return (
    <div className="rounded-card border border-warn/20 bg-warn-soft px-4 py-3 text-xs font-semibold text-warn">
      {L ? `${provider} form đã tách theo sàn, nhưng adapter publish/API chưa bật.` : `${provider} form is marketplace-specific, but publish/API adapter is not enabled yet.`}
    </div>
  );
}

function formFromProduct(product: ProductDetail | null): FormState {
  if (!product) {
    return {
      title: "",
      shortDescription: "",
      description: "",
      categoryId: "",
      categoryPath: "",
      brand: "",
      sku: "",
      barcode: "",
      price: 0,
      compareAtPrice: 0,
      stock: 0,
      weight: 0,
      dimensions: "",
      imageUrls: "",
      videoUrl: "",
      syncMode: "luma_to_shopee",
      minStockThreshold: 0,
      outOfStockBehavior: "keep_visible",
    };
  }
  return {
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
  };
}

function ProductSearchInListing({
  L,
  selectedProduct,
  onSelect,
}: {
  L: boolean;
  selectedProduct: ProductDetail | null;
  onSelect: (productId: string) => void;
}) {
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<PosProduct[]>([]);
  const [isPending, startTransition] = useTransition();
  const query = search.trim();

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      if (!query) {
        setResults([]);
        return;
      }
      startTransition(async () => {
        const rows = await searchPosProducts(query);
        if (!cancelled) setResults(rows);
      });
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  function choose(productId: string, label: string) {
    setSearch(label);
    setResults([]);
    onSelect(productId);
  }

  return (
    <div className="relative flex flex-col gap-1">
      <span className={LABEL}>{L ? "Sản phẩm" : "Product"}</span>
      <Search className="absolute left-3 top-[34px] z-10 h-4 w-4 text-slate-400" />
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={selectedProduct ? selectedProduct.name : (L ? "Tìm theo tên, SKU hoặc barcode..." : "Search by name, SKU, or barcode...")}
        className="h-10 w-full rounded-lg border border-border bg-canvas pl-9 pr-3 text-sm outline-none focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
      />
      {selectedProduct && !query && <div className="text-xs text-slate-500">{selectedProduct.sku} · {selectedProduct.categoryName ?? (L ? "Chưa có danh mục" : "No category")}</div>}
      {(query || isPending) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-xl border border-border bg-surface shadow-e2">
          {isPending ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{L ? "Đang tìm..." : "Searching..."}</span>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">{L ? "Không tìm thấy sản phẩm." : "No products found."}</div>
          ) : (
            <div className="divide-y divide-border-soft">
              {results.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => choose(product.id, product.name)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-lg">{categoryEmoji(product.categoryName)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{product.name}</div>
                    <div className={cn("text-xs", Number(product.stock) <= 0 ? "text-er" : "text-slate-400")}>
                      {product.isVariantParent ? `${product.children.length} SKU con` : `${product.sku} · ${L ? "Tồn" : "Stock"} ${formatNumber(Number(product.stock))} ${product.baseUnit}`}
                    </div>
                  </div>
                  <span className="hidden w-36 shrink-0 truncate text-right text-sm font-semibold tabular-nums text-primary-600 sm:block">
                    {product.isVariantParent ? variantPriceLabel(product) : `${formatCurrency(Number(product.retailPrice))}/${product.baseUnit}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function variantPriceLabel(product: PosProduct) {
  const min = Number(product.minRetailPrice ?? product.retailPrice);
  const max = Number(product.maxRetailPrice ?? product.retailPrice);
  return min !== max ? `${formatCurrency(min)} - ${formatCurrency(max)}` : formatCurrency(max);
}
