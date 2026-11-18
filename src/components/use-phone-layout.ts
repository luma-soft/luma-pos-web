"use client";

import { useSyncExternalStore } from "react";

const PHONE_QUERY = "(max-width: 1023px)";

function subscribePhone(onChange: () => void) {
  const query = window.matchMedia(PHONE_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True below the desktop breakpoint (`lg`), where screens follow the native iOS app. */
export function usePhoneLayout() {
  return useSyncExternalStore(
    subscribePhone,
    () => window.matchMedia(PHONE_QUERY).matches,
    () => false,
  );
}
