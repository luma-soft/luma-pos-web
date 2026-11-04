import { ProductEditorModal } from "@/app/(app)/inventory/tabs/products";

interface Props {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function NewProductModalPage({ searchParams }: Props) {
  const rawParams = await searchParams;
  const params = Object.fromEntries(
    Object.entries(rawParams).flatMap(([key, value]) => {
      const normalized = Array.isArray(value) ? value[0] : value;
      return typeof normalized === "string" ? [[key, normalized]] : [];
    }),
  );

  return (
    <ProductEditorModal
      searchParams={{ ...params, productModal: params.productModal ?? "create" }}
      closeNavigation="back"
      cancelNavigation="back"
    />
  );
}
