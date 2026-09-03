"use client";

import { useRef, useState } from "react";
import { Pencil, X } from "lucide-react";
import { Button } from "@/components/ui";

/** Values keep their identity when their display label is edited. */
export function VariantValuesInput({ values, valueIds, onChange, protectedIds, disabled = false, label }: {
  values: string[];
  valueIds: string[];
  onChange: (values: string[], valueIds: string[]) => void;
  protectedIds: Set<string>;
  disabled?: boolean;
  label: string;
}) {
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);

  function save() {
    const value = draft.trim();
    if (!value) return;
    const index = editing ? valueIds.indexOf(editing) : -1;
    if (values.some((existing, i) => i !== index && existing.trim().toLocaleLowerCase() === value.toLocaleLowerCase())) {
      setError("Giá trị này đã có trong thuộc tính.");
      return;
    }
    if (index >= 0) onChange(values.map((existing, i) => i === index ? value : existing), valueIds);
    else onChange([...values, value], [...valueIds, crypto.randomUUID()]);
    setDraft("");
    setEditing(null);
    setError("");
  }

  return <div>
    <div className="flex min-h-11 flex-wrap items-center gap-1.5 rounded-lg border border-border bg-surface px-2 py-1.5 focus-within:border-primary-600">
      {values.map((value, index) => {
        const id = valueIds[index];
        const protectedValue = protectedIds.has(id);
        return <span key={id ?? value} className="inline-flex items-center rounded-md border border-primary-200 bg-primary-50 text-sm text-primary-700">
          <button type="button" disabled={disabled} title="Đổi tên giá trị" aria-label={`Đổi tên ${value}`}
            onClick={() => { setEditing(id); setDraft(value); setError(""); input.current?.focus(); }}
            className="flex min-h-9 items-center gap-1.5 px-2 text-left disabled:cursor-default">
            {value}<Pencil className="h-3 w-3 opacity-60" />
          </button>
          <Button type="button" size="iconSm" variant="ghost" disabled={disabled || protectedValue}
            title={protectedValue ? "Giá trị đang có SKU. Quản lý trạng thái của SKU thay vì xóa giá trị." : `Bỏ ${value}`}
            aria-label={`Bỏ ${value}`} className="h-9 w-8"
            onClick={() => onChange(values.filter((_, i) => i !== index), valueIds.filter((_, i) => i !== index))}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </span>;
      })}
      {!disabled && <input ref={input} value={draft} aria-label={label} maxLength={100}
        placeholder={editing ? "Đổi tên, nhấn Enter để lưu" : "Nhập giá trị rồi nhấn Enter"}
        className="min-h-9 min-w-40 flex-1 bg-transparent px-1 text-sm outline-none"
        onChange={(event) => { setDraft(event.target.value); setError(""); }}
        onBlur={save}
        onKeyDown={(event) => {
          if (event.key === "Enter") { event.preventDefault(); save(); }
          if (event.key === "Escape") { event.preventDefault(); setDraft(""); setEditing(null); setError(""); }
        }} />}
    </div>
    {error && <p role="alert" className="mt-1 text-xs text-red-600">{error}</p>}
  </div>;
}
