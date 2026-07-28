import Link from "next/link";
import { Routes } from "@/lib/routes";

export function OrderProductLink({
  productId,
  productName,
}: {
  productId: string;
  productName: string;
}) {
  return (
    <Link
      href={Routes.productDetail(productId)}
      className="inline-flex min-h-11 min-w-11 items-center font-medium text-primary-600 hover:underline lg:min-h-0 lg:min-w-0"
    >
      {productName}
    </Link>
  );
}
