"use client";

import { Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function AiQuickActionButton({
  onClick,
  label,
  className,
}: {
  onClick: () => void;
  label: string;
  className?: string;
}) {
  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={cn(
        "h-11 w-11 shrink-0 rounded-xl border-primary-200 bg-primary-50 text-primary-700 shadow-[0_10px_24px_rgba(15,118,110,0.10)] hover:bg-primary-100 lg:h-10 lg:w-10",
        className,
        "min-h-11 min-w-11 sm:min-h-11 sm:min-w-11 md:min-h-11 md:min-w-11",
      )}
    >
      <Sparkles className="h-4 w-4" />
    </Button>
  );
}
