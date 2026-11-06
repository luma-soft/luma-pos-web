import { MergeOrdersModal } from "@/app/(app)/orders/merge/merge-orders-modal";

export default async function MergeOrdersModalPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  return <MergeOrdersModal searchParams={searchParams} />;
}
