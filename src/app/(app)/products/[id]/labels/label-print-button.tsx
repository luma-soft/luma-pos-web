"use client";

import { Printer } from "lucide-react";

export function LabelPrintButton({ label }: { label: string }) {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
    >
      <Printer className="h-4 w-4" />
      {label}
    </button>
  );
}
