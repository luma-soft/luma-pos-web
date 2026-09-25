import type { MouseEvent } from "react";

export function selectAllInputOnClick(event: MouseEvent<HTMLInputElement>) {
  const input = event.currentTarget;
  if (input.value) input.select();
}
