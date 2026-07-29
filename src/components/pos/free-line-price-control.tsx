import { cn } from "@/lib/utils";

type FreeLinePriceControlProps = {
  checked: boolean;
  label: string;
  onCheckedChange: (checked: boolean) => void;
};

export function FreeLinePriceControl({
  checked,
  label,
  onCheckedChange,
}: FreeLinePriceControlProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        "flex min-h-11 min-w-11 w-full items-center justify-between gap-3 rounded-lg border px-3 py-2 text-left text-sm font-medium transition",
        checked
          ? "border-primary-500 bg-primary-50 text-primary-800 dark:bg-primary-950/30 dark:text-primary-200"
          : "border-border bg-surface text-slate-700 hover:bg-surface-2 dark:text-slate-200",
      )}
    >
      <span>{label}</span>
      <span
        aria-hidden="true"
        className={[
          "relative h-6 w-11 shrink-0 rounded-full transition",
          checked ? "bg-primary-600" : "bg-slate-300 dark:bg-slate-600",
        ].join(" ")}
      >
        <span
          className={[
            "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform",
            checked ? "translate-x-5" : "translate-x-0.5",
          ].join(" ")}
        />
      </span>
    </button>
  );
}
