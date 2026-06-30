"use client";

import { Palette, Check } from "lucide-react";
import { THEME_COOKIE, themes, themeMeta, type Theme } from "@/lib/theme/config";
import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";

function persistThemeCookie(theme: Theme) {
  document.cookie = `${THEME_COOKIE}=${encodeURIComponent(theme)}; path=/; max-age=31536000; samesite=lax`;
}

export function ThemeSwitcher({ current }: { current: Theme }) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(current);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    if (open) document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  function pick(t: Theme) {
    setActive(t);
    document.documentElement.setAttribute("data-theme", t);
    persistThemeCookie(t);
    setOpen(false);
  }

  return (
    <div ref={ref} className="relative">
      <Button
        type="button"
        variant="ghost"
        block
        onClick={() => setOpen(!open)}
        className="justify-start px-3"
      >
        <Palette className="w-4 h-4" />
        <Text as="span" variant="subtle" className="flex-1 text-left" text={themeMeta[active].label} />
        <span
          className="w-3.5 h-3.5 rounded-full ring-1 ring-slate-300 dark:ring-slate-700"
          style={{ background: themeMeta[active].swatch }}
        />
      </Button>

      {open && (
        <div className="absolute bottom-full left-0 mb-2 w-full bg-surface border border-border rounded-lg shadow-e2 p-1 z-50">
          {themes.map((t) => (
            <Button
              key={t}
              type="button"
              variant="ghost"
              size="sm"
              block
              onClick={() => pick(t)}
              className="justify-start px-2"
            >
              <span
                className="w-3.5 h-3.5 rounded-full ring-1 ring-slate-300 dark:ring-slate-700 shrink-0"
                style={{ background: themeMeta[t].swatch }}
              />
              <Text as="span" className="flex-1 text-left" text={themeMeta[t].label} />
              {active === t && <Check className="w-3.5 h-3.5 text-primary-600" />}
            </Button>
          ))}
        </div>
      )}
    </div>
  );
}
