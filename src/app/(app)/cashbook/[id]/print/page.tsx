import { notFound } from "next/navigation";
import { AutoPrint } from "@/components/print/auto-print";
import { PrintDoc } from "@/components/print/print-doc";
import { requireStoreContext } from "@/lib/auth/store-context";
import { getCashTransaction } from "@/lib/data/cashbook";
import { getPrintTemplate, type PaperSize } from "@/lib/print/template";
import { Routes } from "@/lib/routes";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ size?: string; templateId?: string }>;
}

export default async function PrintCashTransactionPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { size: sizeParam, templateId } = await searchParams;
  const context = await requireStoreContext();
  const [transaction, template] = await Promise.all([
    getCashTransaction(context.storeId, id),
    getPrintTemplate(context.storeId, "receipt", templateId),
  ]);
  if (!transaction) notFound();

  const size: PaperSize = (["a4", "a5", "k80"] as const).includes(sizeParam as PaperSize)
    ? (sizeParam as PaperSize)
    : template.paperDefault;
  const incoming = transaction.type === "in";
  const fund = transaction.fund === "cash" ? "Tiền mặt" : "Ngân hàng";

  return (
    <>
      <AutoPrint closeHref={`${Routes.Finance}?tab=cashbook`} />
      <div className="print-document-root flex min-h-screen items-start justify-center overflow-auto py-8 print:py-0">
        <PrintDoc
          template={template}
          size={size}
          title={incoming ? "PHIẾU THU" : "PHIẾU CHI"}
          code={transaction.code}
          date={transaction.createdAt}
          partyLabel={incoming ? "Người nộp tiền" : "Người nhận tiền"}
          partyName={transaction.counterparty?.trim() || "—"}
          sellerLabel="Người lập phiếu"
          sellerName={transaction.byName}
          items={[]}
          totals={[]}
          grandTotalLabel="SỐ TIỀN"
          grandTotal={Number(transaction.amount)}
          afterTotals={[]}
          inWordsLabel="Bằng chữ"
          signatures={incoming
            ? ["Người nộp tiền", "Người lập phiếu", "Thủ quỹ"]
            : ["Người nhận tiền", "Người lập phiếu", "Thủ quỹ"]}
          signHint="(Ký, ghi rõ họ tên)"
          note={`${transaction.note ?? "—"} · Hình thức: ${fund}`}
          noteLabel={incoming ? "Lý do nộp" : "Lý do chi"}
          cols={{ product: "Nội dung", unit: "ĐVT", qty: "SL", unitPrice: "Đơn giá", lineTotal: "Thành tiền" }}
        />
      </div>
    </>
  );
}
