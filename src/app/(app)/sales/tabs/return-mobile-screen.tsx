"use client";

import type { ReactNode } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MobilePushedScreen } from "@/components/mobile-pushed-screen";

/** Pushed phone screen for a return; going back drops `expandedReturn` from the URL. */
export function ReturnMobileScreen({ title, actions, children }: { title: string; actions?: ReactNode; children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  function back() {
    const next = new URLSearchParams(searchParams.toString());
    next.delete("expandedReturn");
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }
  return <MobilePushedScreen title={title} actions={actions} onBack={back}>{children}</MobilePushedScreen>;
}
