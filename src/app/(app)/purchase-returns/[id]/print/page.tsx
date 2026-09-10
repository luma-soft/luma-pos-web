import { notFound } from "next/navigation";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getPurchaseReturn } from "@/lib/data/purchase-returns";
import { getPrintTemplate } from "@/lib/print/template";
import { PrintDoc } from "@/components/print/print-doc";
import { PrintToolbar } from "@/components/print/print-toolbar";
export default async function PrintInventoryDocument({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ size?: string }> }) {
  const { id } = await params;
  const requestedSize = (await searchParams).size;
  const size = requestedSize === "a5" || requestedSize === "k80" ? requestedSize : "a4";
  const { storeId } = await requireStoreContext();
  const [doc, template] = await Promise.all([getPurchaseReturn(storeId, id), getPrintTemplate(storeId, "purchase")]);
  if (!doc) notFound();
  return <>
    <PrintToolbar backHref={`/inventory?tab=purchase-returns&expanded=${id}`} baseHref={`/purchase-returns/${id}/print`} size={size} />
    <div className="print-document-root flex min-h-screen items-start justify-center overflow-auto py-8 print:py-0">
      <PrintDoc template={template} size={size} title={doc.status === "draft" ? "PHIẾU TRẢ HÀNG NHẬP (NHÁP)" : "PHIẾU TRẢ HÀNG NHẬP"} code={doc.code} date={doc.createdAt}
        partyLabel="Nhà cung cấp" partyName={doc.supplierName}
        sellerLabel="Người lập" sellerName={doc.createdByName}
        items={doc.items.map((i) => ({ id: i.id, name: i.productName, sku: i.sku, unitName: i.unitName, quantity: Number(i.quantity), unitPrice: Number(i.returnUnitCost), total: Number(i.total) }))}
        totals={[{ label: "Tổng tiền hàng", value: Number(doc.subtotal) }, { label: "Giảm giá", value: Number(doc.discount), negative: true }, { label: "Thuế", value: Number(doc.tax) }]}
        grandTotalLabel="Tổng tiền trả hàng" grandTotal={Number(doc.totalRefund)}
        afterTotals={[{ label: "Tiền hoàn", value: Number(doc.refundAmount) }, { label: "Cấn trừ công nợ", value: Number(doc.debtAmount) }]}
        note={[`Kho: ${doc.warehouseName}`, doc.note].filter(Boolean).join(" · ")}
        inWordsLabel="Bằng chữ" signatures={["Người lập phiếu", "Người giao", "Người nhận"]}
        cols={{ index: "STT", product: "Hàng hóa", unit: "ĐVT", qty: "Số lượng", unitPrice: "Đơn giá", lineTotal: "Thành tiền" }}
      />
    </div>
  </>;
}
