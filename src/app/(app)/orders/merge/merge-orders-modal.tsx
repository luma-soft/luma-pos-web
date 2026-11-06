import { getTranslations } from "next-intl/server";
import { MergeOrdersDialog } from "./merge-orders-dialog";
import { MergeOrdersContent, type MergeOrdersPageProps } from "./merge-orders-content";

export async function MergeOrdersModal({ searchParams }: MergeOrdersPageProps) {
  const t = await getTranslations();

  return (
    <MergeOrdersDialog title={t("merge.title")} closeLabel={t("common.close")}>
      <MergeOrdersContent searchParams={searchParams} presentation="modal" />
    </MergeOrdersDialog>
  );
}
