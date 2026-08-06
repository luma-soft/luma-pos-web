import type { LucideIcon } from "lucide-react";

export function SalesTableEmptyState({
  icon: Icon,
  title,
  description,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
}) {
  return (
    <div className="h-full min-h-[280px] rounded-card border border-dashed border-border bg-surface p-8 text-center text-slate-400 sm:p-12">
      <Icon className="mb-3 h-10 w-10 opacity-60" />
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 text-sm">{description}</p>}
    </div>
  );
}
