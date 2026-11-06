import SalesPage from "@/app/(app)/sales/page";
import { MergeOrdersModal } from "./merge-orders-modal";
import type { MergeOrdersPageProps } from "./merge-orders-content";

export default function MergeOrdersPage({ searchParams }: MergeOrdersPageProps) {
  return (
    <>
      <div aria-hidden="true">
        <SalesPage searchParams={Promise.resolve({ tab: "orders" })} />
      </div>
      <MergeOrdersModal searchParams={searchParams} />
    </>
  );
}
