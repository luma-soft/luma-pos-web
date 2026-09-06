import { internalUseReasonLabel } from "@/lib/inventory/internal-use-reason";
import { notFound } from "next/navigation";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getInternalUseIssue } from "@/lib/data/internal-use";
import { getPrintTemplate } from "@/lib/print/template";
import { PrintDoc } from "@/components/print/print-doc";
import { PrintToolbar } from "@/components/print/print-toolbar";
export default async function PrintInventoryDocument({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ size?: string }> }) {
  const { id } = await params;
  const requestedSize = (await searchParams).size;
  const size = requestedSize === "a5" || requestedSize === "k80" ? requestedSize : "a4";
  const { storeId } = await requireStoreContext();
  const [doc, template] = await Promise.all([getInternalUseIssue(storeId, id), getPrintTemplate(storeId, "purchase")]);
  if (!doc) notFound();
  return <>
    <PrintToolbar backHref={`/inventory?tab=internal&expanded=${id}`} baseHref={`/internal-use/${id}/print`} size={size} />
    <div className="print-document-root flex min-h-screen items-start justify-center overflow-auto py-8 print:py-0">
      <PrintDoc template={template} size={size} title="PHIẾU XUẤT NỘI BỘ" code={doc.code} date={doc.createdAt}
        partyLabel="Người nhận / bộ phận" partyName={doc.department ?? "—"}
        sellerLabel="Người lập" sellerName={doc.createdByName}
        items={doc.items.map((i) => ({ id: i.id, name: i.productName, sku: i.sku, unitName: i.unitName, quantity: Number(i.quantity), unitPrice: Number(i.unitCost), total: Number(i.total) }))}
        totals={[]}
        grandTotalLabel="Tổng giá trị" grandTotal={Number(doc.totalCost)}
        afterTotals={[]}
        note={[`Trạng thái: ${doc.status === "draft" ? "Nháp — chưa xuất kho" : doc.status === "pending" ? "Chờ duyệt — chưa xuất kho" : "Đã xuất kho"}`, `Kho: ${doc.warehouseName}`, `Lý do: ${internalUseReasonLabel(doc.reason, "vi")}`, doc.note].filter(Boolean).join(" · ")}
        inWordsLabel="Bằng chữ" signatures={["Người lập phiếu", "Người giao", "Người nhận"]}
        cols={{ product: "Hàng hóa", unit: "ĐVT", qty: "Số lượng", unitPrice: "Đơn giá", lineTotal: "Thành tiền" }}
      />
    </div>
  </>;
}
