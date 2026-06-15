import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";

const STYLES: Record<string, string> = {
  retail: "bg-surface-2 text-slate-600",
  wholesale: "bg-in-soft text-in",
  contractor: "bg-warn-soft text-warn",
  agent: "bg-violet-50 text-violet-700 dark:bg-violet-950/50 dark:text-violet-400",
};

export function CustomerTypeBadge({ type }: { type: string }) {
  const t = useTranslations();
  return (
    <span className={cn("inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium", STYLES[type] ?? STYLES.retail)}>
      {t(`customers.types.${type}`)}
    </span>
  );
}
