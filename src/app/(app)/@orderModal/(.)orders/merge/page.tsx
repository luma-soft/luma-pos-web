import { getTranslations } from "next-intl/server";
import { MergeOrdersContent } from "@/app/(app)/orders/merge/merge-orders-content";
import { MergeOrdersDialog } from "@/app/(app)/orders/merge/merge-orders-dialog";

export default async function MergeOrdersModalPage({
  searchParams,
}: {
  searchParams: Promise<{ ids?: string | string[] }>;
}) {
  const t = await getTranslations();
  return (
    <MergeOrdersDialog title={t("merge.title")} closeLabel={t("common.close")}>
      <MergeOrdersContent searchParams={searchParams} presentation="modal" />
    </MergeOrdersDialog>
  );
}
