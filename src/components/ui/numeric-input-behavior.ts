import * as React from "react";

const NUMERIC_TEXT = /^[\d.,\s-]*$/;

export function hasInvalidNumericCharacters(value: string, allowNegative: boolean) {
  return !NUMERIC_TEXT.test(value) || (!allowNegative && value.includes("-"));
}

export function useNumericInputBehavior({
  allowNegative,
  onFocus,
  onBeforeInput,
  onPaste,
}: {
  allowNegative: boolean;
  onFocus?: React.FocusEventHandler<HTMLInputElement>;
  onBeforeInput?: React.FormEventHandler<HTMLInputElement>;
  onPaste?: React.ClipboardEventHandler<HTMLInputElement>;
}) {
  return {
    onFocus: (event: React.FocusEvent<HTMLInputElement>) => {
      const target = event.currentTarget;
      const select = () => {
        if (document.activeElement === target) target.select();
      };
      // A parent row can finish its click/focus cycle after onFocus. Apply
      // once immediately and once after that cycle so every numeric field has
      // deterministic replacement-oriented focus behavior.
      select();
      requestAnimationFrame(select);
      window.setTimeout(select, 0);
      onFocus?.(event);
    },
    onBeforeInput: (event: React.FormEvent<HTMLInputElement>) => {
      const native = event.nativeEvent as InputEvent;
      if (native.data && hasInvalidNumericCharacters(native.data, allowNegative)) {
        event.preventDefault();
      }
      onBeforeInput?.(event);
    },
    onPaste: (event: React.ClipboardEvent<HTMLInputElement>) => {
      if (hasInvalidNumericCharacters(event.clipboardData.getData("text"), allowNegative)) {
        event.preventDefault();
      }
      onPaste?.(event);
    },
  };
}
