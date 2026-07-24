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
      href={Routes.product(productId)}
      className="font-medium text-primary-600 hover:underline"
    >
      {productName}
    </Link>
  );
}
