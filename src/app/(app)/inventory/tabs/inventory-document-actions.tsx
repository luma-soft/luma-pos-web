"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Check, Pencil, Printer, Trash2 } from "lucide-react";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { useProductCatalog } from "@/components/product-catalog-provider";
import { Button } from "@/components/ui/button";
import { approveInternalUse, deleteInternalUse } from "@/lib/actions/internal-use";
import { deletePurchaseReturn } from "@/lib/actions/purchase-returns";

export function InventoryDocumentActions({ kind, id, code, status, capabilities, inFooter = false }: { inFooter?: boolean; kind: "internal-use" | "purchase-returns"; id: string; code: string; status?: string; capabilities?: { canEdit: boolean; canDelete: boolean; canApprovePending?: boolean } }) {
  const router = useRouter();
  const t = useTranslations();
  const catalog = useProductCatalog();
  const { confirm } = useConfirmDialog();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const canApprove = kind === "internal-use" && capabilities?.canEdit && (status === "draft" || (status === "pending" && capabilities.canApprovePending));
  const cls = "inline-flex min-h-11 items-center gap-2 rounded-lg border border-border bg-surface px-3 text-sm font-semibold hover:bg-surface-2";
  async function approve() {
    if (!canApprove || busy || !await confirm({ title: `Hoàn thành phiếu ${code}?`, description: "Số lượng trên phiếu sẽ được trừ khỏi tồn kho.", confirmLabel: "Hoàn thành" })) return;
    setBusy(true); setError("");
    try {
      const result = await approveInternalUse(id);
      if (!result.ok) { setError(t(result.error as never)); return; }
      void catalog.refresh(); router.refresh();
    } catch { setError("Không thể hoàn thành phiếu. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  async function remove() {
    if (!capabilities?.canDelete || busy || !await confirm({ title: `Xóa phiếu ${code}?`, description: kind === "purchase-returns" ? "Phiếu sẽ bị xóa. Tồn kho, tiền hoàn và công nợ liên quan sẽ được hoàn lại." : (status === "draft" || status === "pending" ? "Phiếu chưa xuất kho sẽ bị xóa. Tồn kho không thay đổi." : "Phiếu sẽ bị xóa và số lượng đã xuất sẽ được hoàn lại vào kho."), confirmLabel: "Xóa phiếu", variant: "destructive" })) return;
    setBusy(true);
    setError("");
    try {
      const result = await (kind === "internal-use" ? deleteInternalUse(id) : deletePurchaseReturn(id));
      if (!result.ok) { setError(t(result.error as never)); return; }
      void catalog.refresh();
      router.replace(`/inventory?tab=${kind === "internal-use" ? "internal" : "purchase-returns"}`);
      router.refresh();
    } catch { setError("Không thể xóa phiếu. Vui lòng thử lại."); }
    finally { setBusy(false); }
  }
  return <div className={inFooter ? undefined : "mt-4 border-t border-border-soft pt-3"}>
    <div className="flex flex-wrap justify-end gap-2">
      <Link className={cls} href={`/${kind}/${id}/print`} target="_blank" rel="noopener noreferrer"><Printer className="h-4 w-4" />In</Link>
      {canApprove && <Button disabled={busy} onClick={approve}><Check className="h-4 w-4" />Hoàn thành</Button>}
      {capabilities?.canEdit && <Link className={cls} href={`/${kind}/${id}/edit`}><Pencil className="h-4 w-4" />Sửa</Link>}
      {capabilities?.canDelete && <Button variant="destructive" disabled={busy} onClick={remove}><Trash2 className="h-4 w-4" />{busy ? "Đang xóa…" : "Xóa"}</Button>}
    </div>
    {error && <p role="alert" className="mt-2 text-sm text-er">{error}</p>}
  </div>;
}
