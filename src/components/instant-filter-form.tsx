"use client";

import { type FormEvent, type ReactNode, useEffect, useRef } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type Props = {
  action?: string;
  className?: string;
  children: ReactNode;
};

/** A GET form that applies text/filter changes without a submit button. */
export function InstantFilterForm({ action, className, children }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const formRef = useRef<HTMLFormElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  useEffect(() => {
    const onSelectChange = () => schedule();
    window.addEventListener("luma:select-change", onSelectChange);
    return () => window.removeEventListener("luma:select-change", onSelectChange);
  });

  function apply() {
    const form = formRef.current;
    if (!form) return;
    const next = new URLSearchParams(params.toString());
    const keys = new Set<string>();
    new FormData(form).forEach((value, key) => {
      keys.add(key);
      if (typeof value === "string" && value.trim()) next.set(key, value);
      else next.delete(key);
    });
    // Any filter/search change starts from the first result page.
    next.delete("page");
    for (const key of ["q", "status", "category", "stock", "payment", "source", "from", "to"]) {
      if (!keys.has(key)) next.delete(key);
    }
    const target = action || pathname;
    const query = next.toString();
    router.replace(query ? `${target}?${query}` : target, { scroll: false });
  }

  function schedule() {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(apply, 220);
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    apply();
  }

  return (
    <form ref={formRef} action={action} className={className} onSubmit={onSubmit} onInput={schedule} onChange={schedule}>
      {children}
    </form>
  );
}
