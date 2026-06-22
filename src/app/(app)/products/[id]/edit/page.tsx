import { notFound } from "next/navigation";
import { getProduct, getProductFormOptions } from "@/lib/data/products";
import { NewProductForm } from "../../new/product-form";
import type { CreateProductInput } from "../../new/schema";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditProductPage({ params }: Props) {
  const { id } = await params;
  const [product, options] = await Promise.all([getProduct(id), getProductFormOptions()]);
  if (!product) notFound();

  const specs = (product.specs as Record<string, string[]> | null) ?? {};
  const initialValues: Partial<CreateProductInput> = {
    sku: product.sku,
    barcode: product.barcode ?? "",
    name: product.name,
    categoryId: product.categoryId ?? "",
    brandId: product.brandId ?? "",
    supplierIds: product.suppliers.map((s) => s.id),
    imageUrls: product.imageUrls ?? [],
    baseUnit: product.baseUnit,
    costPrice: Number(product.costPrice),
    retailPrice: Number(product.retailPrice),
    wholesalePrice: product.wholesalePrice != null ? Number(product.wholesalePrice) : null,
    contractorPrice: product.contractorPrice != null ? Number(product.contractorPrice) : null,
    agentPrice: product.agentPrice != null ? Number(product.agentPrice) : null,
    location: product.location ?? "",
    description: product.description ?? "",
    directSale: product.isActive,
    units: product.units.map((u) => ({
      unitName: u.unitName,
      multiplier: Number(u.multiplier),
      barcode: u.barcode ?? "",
      priceOverride: u.priceOverride != null ? Number(u.priceOverride) : null,
    })),
    attributes: Object.entries(specs).map(([name, values]) => ({
      name,
      values: Array.isArray(values) ? values : [String(values)],
      createsVariants: false,
    })),
  };

  return (
    <NewProductForm
      mode="edit"
      productId={id}
      isVariantChild={Boolean(product.parentProductId)}
      siblingCount={product.siblings.length}
      initialValues={initialValues}
      categories={options.categories}
      brands={options.brands}
      suppliers={options.suppliers}
    />
  );
}
