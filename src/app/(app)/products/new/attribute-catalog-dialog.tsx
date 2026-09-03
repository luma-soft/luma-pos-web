"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslations } from "next-intl";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { createProductAttribute, deleteProductAttribute, renameProductAttribute } from "@/lib/actions/product-attributes";
import { attributeNameSchema, type ProductAttribute } from "@/lib/products/attribute-catalog";

type View = { kind: "list" } | { kind: "create" } | { kind: "edit" | "delete"; attribute: ProductAttribute };

export function AttributeCatalogDialog({ attributes, create, draftAttributeIds, onClose, onChanged, onCreated }: {
  attributes: ProductAttribute[];
  create: boolean;
  draftAttributeIds: Set<string>;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onCreated: (name: string) => void;
}) {
  const t = useTranslations();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const [view, setView] = useState<View>({ kind: create ? "create" : "list" });
  const [name, setName] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const dialog = dialogRef.current!;
    dialog.showModal();
    return () => dialog.close();
  }, []);

  useEffect(() => {
    if (view.kind === "create" || view.kind === "edit") inputRef.current?.focus();
  }, [view.kind]);

  function open(next: View) {
    setName(next.kind === "edit" ? next.attribute.name : "");
    setError("");
    setView(next);
  }

  function back() {
    if (submitting.current) return;
    if (view.kind === "list" || create) onClose();
    else open({ kind: "list" });
  }

  async function save() {
    if (submitting.current || view.kind === "list") return;
    if (view.kind !== "delete" && !attributeNameSchema.safeParse(name).success) {
      setError("products.attributes.invalidName");
      inputRef.current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    try {
      if (view.kind === "create") {
        const result = await createProductAttribute(name);
        if (!result.ok) { setError(result.error); return; }
        await onChanged();
        onCreated(result.data.name);
        if (create) onClose();
        else open({ kind: "list" });
      } else {
        const result = view.kind === "edit"
          ? await renameProductAttribute(view.attribute.id, name)
          : await deleteProductAttribute(view.attribute.id);
        if (!result.ok) { setError(result.error); return; }
        await onChanged();
        open({ kind: "list" });
      }
    } catch { setError("products.attributes.failed"); }
    finally { submitting.current = false; setPending(false); }
  }

  const title = t(`products.attributes.${view.kind === "list" ? "manage" : view.kind === "create" ? "create" : view.kind === "edit" ? "rename" : "deleteTitle"}`);

  return createPortal(
    <dialog ref={dialogRef} aria-labelledby={titleId}
      className="fixed inset-0 m-auto w-[calc(100%_-_2rem)] max-w-2xl max-h-[85dvh] rounded-2xl border border-border bg-surface p-0 text-slate-900 shadow-e2 backdrop:bg-black/40 dark:text-slate-100"
      onCancel={(event) => { event.preventDefault(); back(); }}
      onKeyDown={(event) => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); back(); } }}
      onClick={(event) => { if (event.target === event.currentTarget) { const r = event.currentTarget.getBoundingClientRect(); if (event.clientX < r.left || event.clientX > r.right || event.clientY < r.top || event.clientY > r.bottom) back(); } }}>
      <div className="flex max-h-[85dvh] flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-border p-5">
          <h2 id={titleId} className="text-xl font-semibold">{title}</h2>
          <Button type="button" variant="ghost" size="icon" disabled={pending} onClick={back} aria-label={t("common.close")}><X className="h-5 w-5" /></Button>
        </header>
        <div className="min-h-0 overflow-y-auto p-5">
          {view.kind === "list" ? <>
            <p className="mb-4 text-sm text-slate-500">{t("products.attributes.manageHint")}</p>
            {attributes.length === 0 && <p className="py-4 text-sm text-slate-500">{t("products.attributes.catalogEmpty")}</p>}
            <ul className="divide-y divide-border">
              {attributes.map((attribute) => {
                const disabledReason = attribute.productCount > 0 ? t("products.attributes.inUse")
                  : draftAttributeIds.has(attribute.id) ? t("products.attributes.inDraft") : undefined;
                return <li key={attribute.id} className="flex items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words font-medium">{attribute.name}</p>
                    <p className="text-sm text-slate-500">{t("products.attributes.usage", { count: attribute.productCount })}</p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" onClick={() => open({ kind: "edit", attribute })} aria-label={t("products.attributes.editNamed", { name: attribute.name })}><Pencil className="h-4 w-4" /></Button>
                  <span title={disabledReason} tabIndex={disabledReason ? 0 : undefined} aria-label={disabledReason}>
                    <Button type="button" variant="ghost" size="icon" disabled={!!disabledReason} onClick={() => open({ kind: "delete", attribute })} aria-label={t("products.attributes.deleteNamed", { name: attribute.name })}><Trash2 className="h-4 w-4" /></Button>
                  </span>
                </li>;
              })}
            </ul>
          </> : view.kind === "delete" ? <p>{t("products.attributes.deleteConfirm", { name: view.attribute.name })}</p> : <>
            <label htmlFor={`${titleId}-name`} className="mb-2 block text-sm font-medium">{t("products.attributes.nameLabel")}</label>
            <input ref={inputRef} id={`${titleId}-name`} value={name} maxLength={100} disabled={pending}
              onChange={(event) => { setName(event.target.value); setError(""); }}
              onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); void save(); } }}
              aria-invalid={!!error} aria-describedby={error ? `${titleId}-error` : undefined}
              placeholder={t("products.attributes.nameExample")} autoComplete="off"
              className="h-11 w-full rounded-lg border border-border bg-surface px-3 text-base outline-none focus:border-primary-600 focus:ring-2 focus:ring-primary-100" />
            {view.kind === "edit" && <p className="mt-3 text-sm text-slate-500">{t("products.attributes.renameHint", { count: view.attribute.productCount })}</p>}
          </>}
          {error && <p id={`${titleId}-error`} role="alert" className="mt-3 text-sm text-red-600">{t(error)}</p>}
        </div>
        <footer className="flex shrink-0 justify-end gap-2 border-t border-border p-5">
          <Button type="button" variant="outline" disabled={pending} onClick={back}>{t(view.kind === "list" ? "common.close" : "common.cancel")}</Button>
          {view.kind === "list" ? <Button type="button" onClick={() => open({ kind: "create" })}><Plus className="h-4 w-4" />{t("products.attributes.create")}</Button>
            : <Button type="button" disabled={pending} onClick={() => void save()}>{t(pending ? "products.attributes.saving" : view.kind === "delete" ? "common.delete" : "common.save")}</Button>}
        </footer>
      </div>
    </dialog>, document.body,
  );
}
