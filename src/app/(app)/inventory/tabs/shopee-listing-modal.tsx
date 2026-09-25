"use client";
import { legacyTextByFlag } from "@/lib/i18n/catalog-text";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useLocale } from "next-intl";
import { Check, ChevronRight, Loader2, Search, Sparkles, UploadCloud, X } from "lucide-react";
import { generateShopeeListingAiFill, loadShopeeCategoryAttributes, loadShopeeCategoryTree, loadShopeeLogisticsChannels, publishShopeeListing, saveShopeeListingDraft } from "@/lib/actions/marketplace";
import type { ProductDetail } from "@/lib/data/products";
import type { PosProduct } from "@/lib/data/pos";
import { MoneyInput } from "@/components/ui/money-input";
import { NumberInput } from "@/components/ui/number-input";
import { Select } from "@/components/ui/select";
import { categoryEmoji } from "@/lib/category-emoji";
import { selectAllInputOnClick } from "@/lib/input-selection";
import { cn, formatCurrency, formatNumber } from "@/lib/utils";
import { isProductStockManaged } from "@/lib/product-stock";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { catalogItemToPosProduct } from "@/lib/pos/product-catalog-adapter";

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
  logisticId: string;
  imageUrls: string;
  videoUrl: string;
  attributeValues: Record<string, string>;
  syncMode: "luma_to_shopee" | "shopee_to_luma" | "manual";
  minStockThreshold: number;
  outOfStockBehavior: "keep_visible" | "unlist" | "set_zero";
};

const FIELD = "min-h-11 w-full rounded-lg border border-border bg-canvas px-3 py-2 text-sm focus:border-primary-500 focus:outline-none lg:min-h-0";
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
  const canPublish = Boolean(product) && provider === "shopee" && form.categoryId.trim().length > 0 && form.title.trim().length > 0 && form.description.trim().length >= 20 && form.price >= 0 && form.stock >= 0;

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
      logisticId: form.logisticId,
      imageUrls: images,
      videoUrl: form.videoUrl,
      attributes: { brand: form.brand, categoryPath: form.categoryPath, ...form.attributeValues },
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
      setMessage(legacyTextByFlag(L, "6fb62f156d77"));
    });
  }

  function save(action: "draft" | "publish") {
    if (!product || provider !== "shopee") {
      setError(legacyTextByFlag(L, "3de80ce2f0aa"));
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
      setMessage(action === "publish" ? (legacyTextByFlag(L, "ef6fe8aff243")) : (legacyTextByFlag(L, "d2a9a57f354d")));
      router.refresh();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-2 sm:p-5">
      <div className="flex h-[min(94dvh,960px)] w-full max-w-6xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
          <div className="min-w-0">
            <div className="text-[10px] font-bold uppercase tracking-wide text-primary-600">{legacyTextByFlag(L, "89a329ca46b4")}</div>
            <h2 className="truncate text-lg font-extrabold">{product ? product.name : (legacyTextByFlag(L, "da3b61b87bb2"))}</h2>
          </div>
          <Link href={closeHref} className="grid h-9 w-9 place-items-center rounded-full border border-border hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0" aria-label="Close">
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
                  <Info label={legacyTextByFlag(L, "1c657b68a7ba")} value={formatCurrency(Number(product.costPrice))} />
                  <Info label={legacyTextByFlag(L, "5b43a3d792e7")} value={formatCurrency(Number(product.retailPrice))} />
                  {isProductStockManaged(product.categoryName) && (
                    <Info label={legacyTextByFlag(L, "75dc5449a256")} value={`${formatNumber(Number(product.totalStock))} ${product.baseUnit}`} />
                  )}
                  <Info label={legacyTextByFlag(L, "3172c4e861e2")} value={product.categoryName ?? "—"} />
                  <Info label={legacyTextByFlag(L, "270f0fef47bb")} value={String(product.children.length)} />
                </>
              ) : (
                <p className="text-sm text-slate-500">{legacyTextByFlag(L, "87a67058c89d")}</p>
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
                <span className={LABEL}>{legacyTextByFlag(L, "438049c1a2a5")}</span>
                <Select
                  value={provider}
                  onValueChange={(value) => setProvider(value as ProviderId)}
                  options={PROVIDERS.map((item) => ({
                    value: item.id,
                    label: `${item.name}${item.ready ? "" : ` · ${legacyTextByFlag(L, "f0080c06cfcc")}`}`,
                  }))}
                  className="w-full"
                />
              </label>
            </div>

            {!product ? (
              <div className="rounded-card border border-dashed border-border bg-canvas px-4 py-10 text-center text-sm text-slate-400">
                {legacyTextByFlag(L, "e45351b19199")}
              </div>
            ) : (
              <>
            <div className="flex flex-wrap items-center gap-2">
              <button type="button" disabled={aiPending || provider !== "shopee"} onClick={autoFill} className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
                {aiPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                {legacyTextByFlag(L, "02c83daf3957")}
              </button>
              <span className="text-xs text-slate-500">
                {provider === "shopee"
                  ? (legacyTextByFlag(L, "57e8953996ba"))
                  : (legacyTextByFlag(L, "fd8d819f1ec4"))}
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
                <div className={LABEL}>{legacyTextByFlag(L, "691620fe0b93")}</div>
                <div className="mt-2 grid gap-2">
                  {product.children.map((child) => (
                    <div key={child.id} className="grid grid-cols-[1fr_auto_auto] gap-3 rounded-lg bg-canvas px-3 py-2 text-sm">
                      <span className="truncate font-medium">{child.variantName || child.name}</span>
                      <span className="tabular-nums">{formatCurrency(Number(child.retailPrice))}</span>
                      {isProductStockManaged(product.categoryName) && (
                        <span className="tabular-nums text-slate-500">{formatNumber(Number(child.totalStock))}</span>
                      )}
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
          <span className="text-xs text-slate-500">{legacyTextByFlag(L, "d0343104a431")}</span>
          <div className="flex gap-2">
            <button type="button" disabled={pending} onClick={() => save("draft")} className="inline-flex items-center gap-2 rounded-full border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2 disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
              {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
              {legacyTextByFlag(L, "f6b14ad03ac3")}
            </button>
            <button type="button" disabled={pending || !canPublish} onClick={() => save("publish")} className="inline-flex items-center gap-2 rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">
              {legacyTextByFlag(L, "10b8292ebf66")}
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

type ShopeeCategoryNode = {
  id: string;
  name: string;
  children?: ShopeeCategoryNode[];
};

type ShopeeCategoryPick = {
  id: string;
  path: string;
};

type ShopeeCategoryAttribute = {
  id: string;
  name: string;
  mandatory: boolean;
  inputType: string;
  values: { id: string; name: string }[];
};

type ShopeeLogisticsChannel = {
  id: string;
  name: string;
  enabled: boolean;
};

function ShopeeCategoryPicker({ L, value, onChange }: { L: boolean; value: string; onChange: (category: ShopeeCategoryPick) => void }) {
  const [open, setOpen] = useState(false);
  const [tree, setTree] = useState<ShopeeCategoryNode[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function openPicker() {
    setOpen(true);
    if (tree.length > 0 || loading) return;
    setLoading(true);
    setError("");
    loadShopeeCategoryTree().then((res) => {
      if (res.ok) {
        setTree(res.data.tree);
      } else {
        setError(res.error);
      }
      setLoading(false);
    });
  }

  return (
    <div className="flex flex-col gap-1">
      <span className="text-sm font-semibold">
        {legacyTextByFlag(L, "79657f3097e5")} <span className="text-er">*</span>
      </span>
      <button
        type="button"
        onClick={openPicker}
        className={cn(
          "flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-border bg-canvas px-3 text-left text-sm hover:bg-surface-2 focus:border-primary-500 focus:outline-none",
          !value && "text-slate-400",
        )}
      >
        <span className="min-w-0 truncate">{value || (legacyTextByFlag(L, "321febbbd9fb"))}</span>
        <ChevronRight className="h-4 w-4 rotate-90 text-slate-400" />
      </button>
      {open && (
        <ShopeeCategoryDialog
          L={L}
          currentPath={value}
          tree={tree}
          loading={loading}
          error={error}
          onClose={() => setOpen(false)}
          onConfirm={(category) => { onChange(category); setOpen(false); }}
        />
      )}
    </div>
  );
}

function ShopeeCategoryDialog({
  L,
  currentPath,
  tree,
  loading,
  error,
  onClose,
  onConfirm,
}: {
  L: boolean;
  currentPath: string;
  tree: ShopeeCategoryNode[];
  loading: boolean;
  error: string;
  onClose: () => void;
  onConfirm: (category: ShopeeCategoryPick) => void;
}) {
  const [query, setQuery] = useState("");
  const [level1, setLevel1] = useState<ShopeeCategoryNode | null>(null);
  const [level2, setLevel2] = useState<ShopeeCategoryNode | null>(null);
  const [selected, setSelected] = useState<ShopeeCategoryPick | null>(() => flattenShopeeCategories(tree).find((category) => category.path === currentPath) ?? null);
  const activeLevel1 = level1 ?? tree.find((node) => currentPath.startsWith(node.name)) ?? tree[0] ?? null;

  const searchResults = useMemo(() => {
    const q = normalizeCategorySearch(query);
    if (!q) return [];
    return flattenShopeeCategories(tree).filter((category) => normalizeCategorySearch(category.path).includes(q)).slice(0, 30);
  }, [query, tree]);
  const children = activeLevel1?.children ?? [];

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/45 p-3 sm:p-5">
      <div className="flex h-[min(88dvh,760px)] w-full max-w-5xl flex-col overflow-hidden rounded-2xl bg-surface shadow-2xl">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <h3 className="text-xl font-extrabold">{legacyTextByFlag(L, "321febbbd9fb")}</h3>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-500" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onClick={selectAllInputOnClick}
              autoFocus
              className="h-11 w-full rounded-lg border border-border bg-canvas pl-10 pr-3 text-sm focus:border-primary-500 focus:outline-none lg:h-10"
              placeholder={legacyTextByFlag(L, "e0e1ae6e892c")}
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden border-t border-border-soft">
          {loading ? (
            <div className="grid h-full place-items-center text-sm text-slate-500">
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{legacyTextByFlag(L, "997ab229b62d")}</span>
            </div>
          ) : error ? (
            <div className="grid h-full place-items-center px-6 text-center text-sm text-er">
              <div>
                <div className="font-bold">{legacyTextByFlag(L, "d779f8b9aacf")}</div>
                <div className="mt-1 text-xs text-slate-500">{error}</div>
              </div>
            </div>
          ) : query.trim() ? (
            <div className="h-full overflow-auto p-4">
              {searchResults.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-slate-400">{legacyTextByFlag(L, "737fca001312")}</div>
              ) : searchResults.map((category) => (
                <button
                  key={category.id}
                  type="button"
                  onClick={() => setSelected(category)}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0",
                    selected?.id === category.id && "bg-primary-50 text-primary-700 dark:bg-primary-950/40",
                  )}
                >
                  <span className="min-w-0 truncate">{category.path}</span>
                  {selected?.id === category.id ? <Check className="h-4 w-4 text-primary-600" /> : null}
                </button>
              ))}
            </div>
          ) : (
            <div className="grid h-full min-h-0 grid-cols-1 md:grid-cols-[320px_1fr]">
              <div className="overflow-auto border-r border-border-soft py-2">
                {tree.length === 0 ? (
                  <div className="px-5 py-10 text-sm text-slate-400">{legacyTextByFlag(L, "ab327a726a25")}</div>
                ) : tree.map((node) => (
                  <CategoryRow key={node.id} active={activeLevel1?.id === node.id} label={node.name} hasChildren={Boolean(node.children?.length)} onClick={() => { setLevel1(node); setLevel2(null); }} />
                ))}
              </div>
              <div className="overflow-auto py-2">
                {!activeLevel1 ? (
                  <div className="px-5 py-10 text-sm text-slate-400">{legacyTextByFlag(L, "189ed1fba835")}</div>
                ) : children.length === 0 ? (
                  <CategoryRow active={selected?.id === activeLevel1.id} label={activeLevel1.name} onClick={() => setSelected(categoryPick(activeLevel1, []))} />
                ) : children.map((child) => (
                  <CategoryRow
                    key={child.id}
                    active={level2?.id === child.id || selected?.id === child.id}
                    label={child.name}
                    hasChildren={Boolean(child.children?.length)}
                    onClick={() => {
                      if (child.children?.length) setLevel2(child);
                      else {
                        setLevel2(child);
                        setSelected(categoryPick(child, [activeLevel1.name]));
                      }
                    }}
                  />
                ))}
                {level2?.children?.length ? (
                  <div className="mt-3 border-t border-border-soft pt-2">
                    {level2.children.map((child) => (
                      <CategoryRow
                        key={child.id}
                        active={selected?.id === child.id}
                        label={child.name}
                        onClick={() => setSelected(categoryPick(child, [activeLevel1?.name ?? "", level2.name]))}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-border-soft px-5 py-4">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-4 py-2 text-sm font-semibold hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0">{legacyTextByFlag(L, "3b9363169ccc")}</button>
          <button
            type="button"
            disabled={!selected}
            onClick={() => selected && onConfirm(selected)}
            className="rounded-lg bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
          >
            {legacyTextByFlag(L, "3e9f7a91e7af")}
          </button>
        </div>
      </div>
    </div>
  );
}

function CategoryRow({ active, label, hasChildren, onClick }: { active?: boolean; label: string; hasChildren?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("flex w-full items-center justify-between gap-3 px-5 py-3 text-left text-sm font-semibold hover:bg-surface-2 min-h-11", active && "bg-primary-50 text-primary-700 dark:bg-primary-950/40")}
    >
      <span className="min-w-0 truncate">{label}</span>
      {hasChildren ? <ChevronRight className="h-4 w-4 shrink-0 text-slate-500" /> : active ? <Check className="h-4 w-4 shrink-0 text-primary-600" /> : null}
    </button>
  );
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
            {legacyTextByFlag(L, "c4dd9f946d26")}
          </div>
          <div className="mt-1 grid grid-cols-2 gap-2 text-xs text-slate-600 dark:text-slate-300 md:grid-cols-4">
            <PriceMetric label={legacyTextByFlag(L, "eb302aa637a8")} value={costPrice > 0 ? formatCurrency(costPrice) : "—"} />
            <PriceMetric label={legacyTextByFlag(L, "c889c1b09155")} value={`${Math.round(assumption.percentFee * 1000) / 10}%${assumption.fixedFee ? ` + ${formatCurrency(assumption.fixedFee)}` : ""}`} />
            <PriceMetric label={legacyTextByFlag(L, "1621d26cdfdf")} value={`${Math.round(targetMarginRate * 100)}%`} />
            <PriceMetric label={legacyTextByFlag(L, "6a894f893f81")} value={currentPrice > 0 ? `${formatCurrency(currentProfit)} (${Math.round(currentMargin * 100)}%)` : "—"} />
          </div>
          <p className="mt-2 text-xs text-slate-500">
            {legacyTextByFlag(L, "f5b98c111f9b", { label: assumption.label })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 lg:justify-end">
          <div className="text-right">
            <div className="text-[10px] font-bold uppercase tracking-wide text-slate-500">{legacyTextByFlag(L, "5db96ec9f5ca")}</div>
            <div className="text-lg font-extrabold tabular-nums text-primary-700 dark:text-primary-300">{canSuggest ? formatCurrency(suggestedPrice) : "—"}</div>
          </div>
          <button
            type="button"
            disabled={!canSuggest}
            onClick={() => onUse(suggestedPrice)}
            className="rounded-full bg-primary-600 px-4 py-2 text-sm font-semibold text-white hover:brightness-110 disabled:opacity-50 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
          >
            {legacyTextByFlag(L, "1f2be83d73ac")}
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

function categoryPick(node: ShopeeCategoryNode, parents: string[]): ShopeeCategoryPick {
  const path = [...parents, node.name].filter(Boolean).join("/");
  return { id: node.id, path };
}

function flattenShopeeCategories(nodes: ShopeeCategoryNode[], parents: string[] = []): ShopeeCategoryPick[] {
  return nodes.flatMap((node) => {
    const current = categoryPick(node, parents);
    const children = node.children ? flattenShopeeCategories(node.children, [...parents, node.name]) : [];
    return node.children?.length ? children : [current];
  });
}

function normalizeCategorySearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
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
  const [attributes, setAttributes] = useState<ShopeeCategoryAttribute[]>([]);
  const [attributesLoading, setAttributesLoading] = useState(false);
  const [attributesError, setAttributesError] = useState("");
  const [logistics, setLogistics] = useState<ShopeeLogisticsChannel[]>([]);
  const [logisticsLoading, setLogisticsLoading] = useState(true);
  const [logisticsError, setLogisticsError] = useState("");

  useEffect(() => {
    let cancelled = false;
    loadShopeeLogisticsChannels().then((res) => {
      if (cancelled) return;
      if (res.ok) {
        setLogistics(res.data.channels);
      } else {
        setLogisticsError(res.error);
      }
      setLogisticsLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  function loadCategoryAttributes(categoryId: string) {
    setAttributes([]);
    setAttributesError("");
    if (!categoryId) return;
    setAttributesLoading(true);
    loadShopeeCategoryAttributes(categoryId).then((res) => {
      if (res.ok) {
        setAttributes(res.data.attributes);
      } else {
        setAttributesError(res.error);
      }
      setAttributesLoading(false);
    });
  }

  function setAttribute(attributeId: string, value: string) {
    set("attributeValues", { ...form.attributeValues, [attributeId]: value });
  }

  function selectCategory(category: ShopeeCategoryPick) {
    set("categoryId", category.id);
    set("categoryPath", category.path);
    set("attributeValues", {});
    loadCategoryAttributes(category.id);
  }

  return (
    <>
      <section className="space-y-3 rounded-card border border-border-soft bg-surface px-4 py-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-extrabold">{legacyTextByFlag(L, "bbc7204958db")}</h3>
            <p className="mt-1 text-xs text-slate-500">
              {legacyTextByFlag(L, "c09e0e30f8d7")}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2 text-[#ee4d2d]">
            <span className="grid h-8 w-8 place-items-center rounded-md bg-[#ee4d2d] text-base font-extrabold text-white">S</span>
            <span className="hidden text-lg font-semibold sm:block">Shopee</span>
          </div>
        </div>
        <ShopeeCategoryPicker
          L={L}
          value={form.categoryId ? form.categoryPath : ""}
          onChange={selectCategory}
        />
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={legacyTextByFlag(L, "edf1244f4478")}><input className={FIELD} value={form.title} maxLength={120} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "2ef6b15c0b5f")}><input className={FIELD} value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
          <Field label="Seller SKU"><input className={FIELD} value={form.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "dded874d4b6b")}><MoneyInput className={FIELD} value={form.price} min={0} onChange={(value) => set("price", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "9dd3422dfa2c")}><NumberInput className={FIELD} min={0} value={form.stock} onChange={(value) => set("stock", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "d25a858575fc")}>
            {logistics.length > 0 ? (
              <Select
                value={form.logisticId}
                onValueChange={(value) => set("logisticId", value)}
                options={[
                  { value: "", label: legacyTextByFlag(L, "fced57459404") },
                  ...logistics.filter((channel) => channel.enabled).map((channel) => ({ value: channel.id, label: channel.name })),
                ]}
                className="w-full"
              />
            ) : (
              <div className={cn(FIELD, "flex h-10 items-center text-slate-400")}>
                {logisticsLoading ? (legacyTextByFlag(L, "5977dba98ddd")) : logisticsError || (legacyTextByFlag(L, "fe242d8be9af"))}
              </div>
            )}
          </Field>
        </div>
        {form.categoryId && (
          <div className="rounded-card border border-border-soft bg-canvas p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className={LABEL}>{legacyTextByFlag(L, "1206a998b28c")}</div>
                <p className="mt-1 text-xs text-slate-500">
                  {legacyTextByFlag(L, "e7578bba9baf")}
                </p>
              </div>
              {attributesLoading && <Loader2 className="h-4 w-4 animate-spin text-slate-400" />}
            </div>
            {attributesError ? (
              <div className="mt-3 rounded-lg bg-er-soft px-3 py-2 text-xs font-semibold text-er">{attributesError}</div>
            ) : attributes.length === 0 && !attributesLoading ? (
              <div className="mt-3 text-xs text-slate-400">{legacyTextByFlag(L, "dbc1b62d3ee4")}</div>
            ) : (
              <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-2">
                {attributes.filter((attribute) => attribute.mandatory).slice(0, 12).map((attribute) => (
                  <Field key={attribute.id} label={`${attribute.name} *`}>
                    {attribute.values.length > 0 ? (
                      <Select
                        value={form.attributeValues[attribute.id] ?? ""}
                        onValueChange={(value) => setAttribute(attribute.id, value)}
                        options={[
                          { value: "", label: legacyTextByFlag(L, "0203a4907821") },
                          ...attribute.values.slice(0, 80).map((value) => ({ value: value.id, label: value.name })),
                        ]}
                        className="w-full"
                      />
                    ) : (
                      <input
                        className={FIELD}
                        value={form.attributeValues[attribute.id] ?? ""}
                        onChange={(event) => setAttribute(attribute.id, event.target.value)}
                        placeholder={attribute.inputType || (legacyTextByFlag(L, "a038bab398c2"))}
                      />
                    )}
                  </Field>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      <FormSection title={legacyTextByFlag(L, "6edd22b73a30")} note={legacyTextByFlag(L, "f392a8737ffa")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={legacyTextByFlag(L, "3f3475a0a141")}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} value={form.imageUrls} onChange={(e) => set("imageUrls", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "6015ffc7daeb")}><textarea className={cn(FIELD, "min-h-24")} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "15f639ebebf2")}><NumberInput className={FIELD} min={0} decimals={4} value={form.weight} onChange={(value) => set("weight", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "039faf966639")}><input className={FIELD} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} placeholder="20 x 10 x 8" /></Field>
          <Field label={legacyTextByFlag(L, "46fb3bc0a6d3")}><input className={FIELD} value={form.logisticId} onChange={(e) => set("logisticId", e.target.value)} placeholder={legacyTextByFlag(L, "e9504dee0337")} /></Field>
          <Field label={legacyTextByFlag(L, "cb3f98908866")}><textarea className={cn(FIELD, "min-h-20 font-mono text-xs")} value={JSON.stringify({ brand: form.brand, categoryPath: form.categoryPath, ...form.attributeValues }, null, 2)} readOnly /></Field>
        </div>
      </FormSection>
      <SyncFields form={form} set={set} L={L} />
    </>
  );
}

function TikTokListingFields({ form, set, L }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; L: boolean }) {
  return (
    <>
      <FormSection title="TikTok Shop" note={legacyTextByFlag(L, "d972daedd307")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={legacyTextByFlag(L, "386c02c7dfe8")}><input className={FIELD} value={form.title} maxLength={255} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "638888075acd")}><input className={FIELD} value={form.categoryPath} onChange={(e) => set("categoryPath", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "ca61cdeb5c7f")}><input className={FIELD} value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
          <Field label="Seller SKU"><input className={FIELD} value={form.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "7e3fadfad006")}><MoneyInput className={FIELD} value={form.price} min={0} onChange={(value) => set("price", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "9be76c1f3ab2")}><NumberInput className={FIELD} min={0} value={form.stock} onChange={(value) => set("stock", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "7181ca3e7c27")}><NumberInput className={FIELD} min={0} decimals={4} value={form.weight} onChange={(value) => set("weight", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "d810c16c5323")}><input className={FIELD} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} /></Field>
        </div>
        <Field label={legacyTextByFlag(L, "1d951388ecb6")}><textarea className={cn(FIELD, "min-h-32")} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label={legacyTextByFlag(L, "f0bd15aea2f3")}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} value={form.imageUrls} onChange={(e) => set("imageUrls", e.target.value)} /></Field>
      </FormSection>
      <AdapterPending provider="TikTok Shop" L={L} />
    </>
  );
}

function LazadaListingFields({ form, set, L }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; L: boolean }) {
  return (
    <>
      <FormSection title="Lazada" note={legacyTextByFlag(L, "9b3ed4835607")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={legacyTextByFlag(L, "243348471e57")}><input className={FIELD} value={form.categoryPath} onChange={(e) => set("categoryPath", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "df4c6e15deac")}><input className={FIELD} value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "ca61cdeb5c7f")}><input className={FIELD} value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "97a247f8bd92")}><input className={FIELD} placeholder={legacyTextByFlag(L, "ac7058a832cf")} /></Field>
          <Field label="SellerSku"><input className={FIELD} value={form.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "f888c63bd999")}><NumberInput className={FIELD} min={0} value={form.stock} onChange={(value) => set("stock", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "ea4daad6802b")}><MoneyInput className={FIELD} value={form.price} min={0} onChange={(value) => set("price", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "3b6fe915e58d")}><MoneyInput className={FIELD} value={form.compareAtPrice} min={0} onChange={(value) => set("compareAtPrice", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "7181ca3e7c27")}><NumberInput className={FIELD} min={0} decimals={4} value={form.weight} onChange={(value) => set("weight", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "d810c16c5323")}><input className={FIELD} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} /></Field>
        </div>
        <Field label={legacyTextByFlag(L, "ae3c3e0b217f")}><textarea className={cn(FIELD, "min-h-32")} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label={legacyTextByFlag(L, "0049661513d7")}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} value={form.imageUrls} onChange={(e) => set("imageUrls", e.target.value)} /></Field>
      </FormSection>
      <AdapterPending provider="Lazada" L={L} />
    </>
  );
}

function TikiListingFields({ form, set, L }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; L: boolean }) {
  return (
    <>
      <FormSection title="Tiki" note={legacyTextByFlag(L, "9cce19132ed3")}>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <Field label={legacyTextByFlag(L, "f743c66c7848")}><input className={FIELD} value={form.categoryPath} onChange={(e) => set("categoryPath", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "386cc3272911")}><input className={FIELD} value={form.title} onChange={(e) => set("title", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "ca61cdeb5c7f")}><input className={FIELD} value={form.brand} onChange={(e) => set("brand", e.target.value)} /></Field>
          <Field label="Seller SKU"><input className={FIELD} value={form.sku} onChange={(e) => set("sku", e.target.value)} /></Field>
          <Field label={legacyTextByFlag(L, "fcf865a68ac5")}><MoneyInput className={FIELD} value={form.price} min={0} onChange={(value) => set("price", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "8f62f0fff83b")}><NumberInput className={FIELD} min={0} value={form.stock} onChange={(value) => set("stock", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "a92a5ec58dc0")}><NumberInput className={FIELD} min={0} decimals={4} value={form.weight} onChange={(value) => set("weight", value ?? 0)} /></Field>
          <Field label={legacyTextByFlag(L, "917664212f1c")}><input className={FIELD} value={form.dimensions} onChange={(e) => set("dimensions", e.target.value)} /></Field>
        </div>
        <Field label={legacyTextByFlag(L, "3334eb9934f6")}><textarea className={cn(FIELD, "min-h-32")} value={form.description} onChange={(e) => set("description", e.target.value)} /></Field>
        <Field label={legacyTextByFlag(L, "895a7b6d3902")}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} placeholder={legacyTextByFlag(L, "82c69b1deb0b")} /></Field>
        <Field label={legacyTextByFlag(L, "0049661513d7")}><textarea className={cn(FIELD, "min-h-24 font-mono text-xs")} value={form.imageUrls} onChange={(e) => set("imageUrls", e.target.value)} /></Field>
      </FormSection>
      <AdapterPending provider="Tiki" L={L} />
    </>
  );
}

function SyncFields({ form, set, L }: { form: FormState; set: <K extends keyof FormState>(key: K, value: FormState[K]) => void; L: boolean }) {
  return (
    <FormSection title={legacyTextByFlag(L, "c8cefb39fe77")}>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label={legacyTextByFlag(L, "e451c140bb31")}>
          <Select
            value={form.syncMode}
            onValueChange={(value) => set("syncMode", value as FormState["syncMode"])}
            options={[
              { value: "luma_to_shopee", label: legacyTextByFlag(L, "e405652b16a8") },
              { value: "shopee_to_luma", label: legacyTextByFlag(L, "8b5efc041622") },
              { value: "manual", label: "Manual" },
            ]}
            className="w-full"
          />
        </Field>
        <Field label={legacyTextByFlag(L, "d4583f251a0c")}><NumberInput className={FIELD} min={0} decimals={4} value={form.minStockThreshold} onChange={(value) => set("minStockThreshold", value ?? 0)} /></Field>
        <Field label={legacyTextByFlag(L, "25b2b4f1a6d8")}>
          <Select
            value={form.outOfStockBehavior}
            onValueChange={(value) => set("outOfStockBehavior", value as FormState["outOfStockBehavior"])}
            options={[
              { value: "keep_visible", label: legacyTextByFlag(L, "6915a1c6d014") },
              { value: "unlist", label: legacyTextByFlag(L, "dea0d40fa780") },
              { value: "set_zero", label: legacyTextByFlag(L, "736a05178c80") },
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
      {legacyTextByFlag(L, "8b598058f8b5", { provider })}
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
      logisticId: "",
      imageUrls: "",
      videoUrl: "",
      attributeValues: {},
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
    logisticId: "",
    imageUrls: Array.isArray(product.imageUrls) ? product.imageUrls.join("\n") : "",
    videoUrl: "",
    attributeValues: {},
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
  const catalog = useProductCatalog();
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
      startTransition(() => {
        const defaultWarehouseId = catalog.snapshot?.warehouses.find((warehouse) => warehouse.isDefault)?.id ?? null;
        const rows = catalog.search(query, { limit: 30 }).map((product) =>
          catalogItemToPosProduct(product, catalog.products, defaultWarehouseId)
        );
        if (!cancelled) setResults(rows);
      });
    }, query ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [catalog, query]);

  function choose(productId: string, label: string) {
    setSearch(label);
    setResults([]);
    onSelect(productId);
  }

  return (
    <div className="relative flex flex-col gap-1">
      <span className={LABEL}>{legacyTextByFlag(L, "67403942504d")}</span>
      <Search className="absolute left-3 top-[34px] z-10 h-4 w-4 text-slate-400" />
      <input
        type="text"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        onClick={selectAllInputOnClick}
        placeholder={selectedProduct ? selectedProduct.name : (legacyTextByFlag(L, "b8d56b1a11bb"))}
        className="h-11 w-full rounded-lg border border-border bg-canvas pl-9 pr-3 text-sm focus:border-primary-500 focus:outline-none lg:h-10"
      />
      {selectedProduct && !query && <div className="text-xs text-slate-500">{selectedProduct.sku} · {selectedProduct.categoryName ?? (legacyTextByFlag(L, "7d78c9ff9bf2"))}</div>}
      {(query || isPending) && (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-72 overflow-auto rounded-xl border border-border bg-surface shadow-e2">
          {isPending ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">
              <span className="inline-flex items-center gap-2"><Loader2 className="h-4 w-4 animate-spin" />{legacyTextByFlag(L, "f01bef56e435")}</span>
            </div>
          ) : results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-400">{legacyTextByFlag(L, "ed982db0890e")}</div>
          ) : (
            <div className="divide-y divide-border-soft">
              {results.map((product) => (
                <button
                  key={product.id}
                  type="button"
                  onClick={() => choose(product.id, product.name)}
                  className="flex w-full items-center gap-3 px-3 py-2 text-left hover:bg-surface-2 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
                >
                  <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-surface-2 text-lg">{categoryEmoji(product.categoryName)}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold">{product.name}</div>
                    <div className={cn("text-xs", isProductStockManaged(product.categoryName) && Number(product.stock) <= 0 ? "text-er" : "text-slate-400")}>
                      {product.isVariantParent
                        ? `${product.children.length} SKU con`
                        : isProductStockManaged(product.categoryName)
                          ? `${product.sku} · ${legacyTextByFlag(L, "75dc5449a256")} ${formatNumber(Number(product.stock))} ${product.baseUnit}`
                          : product.sku}
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
