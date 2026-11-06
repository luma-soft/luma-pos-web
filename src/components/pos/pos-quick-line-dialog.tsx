"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useLocale, useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MoneyInput } from "@/components/ui/money-input";

export type QuickPosLineInput = {
  name: string;
  sku: string;
  unit: string;
  price: number;
};

type PosQuickLineDialogProps = {
  onClose: () => void;
  onAdd: (input: QuickPosLineInput) => void;
};

function generateQuickLineSku() {
  const suffix = Math.floor(Math.random() * 36 ** 3).toString(36).padStart(3, "0").toUpperCase();
  return `SP${Date.now().toString(36).toUpperCase()}${suffix}`;
}

export function PosQuickLineDialog({ onClose, onAdd }: PosQuickLineDialogProps) {
  const t = useTranslations("pos.quickLine");
  const locale = useLocale();
  const [name, setName] = useState("");
  const [sku, setSku] = useState(generateQuickLineSku);
  const [unit, setUnit] = useState(locale === "vi" ? "cái" : "piece");
  const [price, setPrice] = useState<number | null>(null);
  const [invalid, setInvalid] = useState(false);
  const onCloseRef = useRef(onClose);

  useEffect(() => { onCloseRef.current = onClose; }, [onClose]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseRef.current();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!name.trim() || !unit.trim() || price == null || !Number.isFinite(price) || price < 0) {
      setInvalid(true);
      return;
    }
    onAdd({
      name: name.trim(),
      sku: sku.trim() || generateQuickLineSku(),
      unit: unit.trim(),
      price,
    });
    onClose();
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex items-end justify-center bg-slate-950/40 p-0 sm:items-center sm:p-4"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="pos-quick-line-title"
        className="max-h-[calc(100dvh-1rem)] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-border bg-surface px-4 py-5 shadow-2xl sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
      >
        <div className="mb-4">
          <h2 id="pos-quick-line-title" className="text-lg font-semibold">{t("title")}</h2>
          <p className="mt-1 text-sm text-slate-500">{t("localOnly")}</p>
        </div>
        <form onSubmit={submit} className="space-y-4">
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{t("sku")}</span>
            <Input value={sku} onChange={(event) => { setSku(event.target.value); setInvalid(false); }} autoComplete="off" autoCapitalize="characters" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{t("name")}</span>
            <Input autoFocus value={name} onChange={(event) => { setName(event.target.value); setInvalid(false); }} autoComplete="off" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{t("unit")}</span>
            <Input value={unit} onChange={(event) => { setUnit(event.target.value); setInvalid(false); }} autoComplete="off" />
          </label>
          <label className="block space-y-1.5 text-sm font-medium">
            <span>{t("price")}</span>
            <MoneyInput
              min={0}
              value={price}
              onChange={(value) => { setPrice(value); setInvalid(false); }}
              className="flex h-11 w-full rounded-lg border border-border bg-surface px-3 text-base transition-[border-color,background-color] duration-150 placeholder:text-slate-400 focus:border-primary-600 focus:outline-none disabled:cursor-not-allowed disabled:opacity-50 lg:h-10 lg:text-sm"
            />
          </label>
          {invalid && <p role="alert" className="text-sm text-red-600">{t("invalid")}</p>}
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">{t("cannotSubmit")}</p>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" onClick={onClose}>{t("cancel")}</Button>
            <Button type="submit">{t("add")}</Button>
          </div>
        </form>
      </section>
    </div>,
    document.body,
  );
}
