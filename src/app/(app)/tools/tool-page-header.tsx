import type { ReactNode } from "react";

export function ToolPageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="border-b border-border bg-surface px-4 py-5 sm:px-6 md:px-7 md:py-6">
      <div className="mx-auto flex w-full max-w-[94rem] flex-col items-start gap-3 sm:flex-row sm:gap-4">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 text-[10px] font-bold uppercase tracking-[0.09em] text-primary-600">
            {eyebrow}
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-950 dark:text-white">{title}</h1>
          {description && (
            <p className="mt-1.5 max-w-3xl text-sm leading-6 text-slate-500 dark:text-slate-400">{description}</p>
          )}
        </div>
        {actions && <div className="shrink-0 sm:pt-0.5">{actions}</div>}
      </div>
    </header>
  );
}
