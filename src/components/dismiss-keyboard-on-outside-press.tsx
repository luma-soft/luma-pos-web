"use client";

import { useEffect } from "react";

const FORM_FIELD_SELECTOR = [
  "input:not([type='hidden'])",
  "textarea",
  "select",
  "[contenteditable='true']",
  "[contenteditable='']",
].join(", ");

const DROPDOWN_SELECTOR = "select, [aria-haspopup], [role='combobox'], [data-dismiss-keyboard]";
const BUTTON_SELECTOR = "button, [role='button']";

function isElement(target: EventTarget | null): target is Element {
  return target instanceof Element;
}

function isKeyboardField(element: Element | null): boolean {
  return Boolean(element?.matches("input:not([type='hidden']), textarea, [contenteditable='true'], [contenteditable='']"));
}

/**
 * Dismiss the mobile keyboard when a form loses attention to page content.
 *
 * Buttons deliberately keep the keyboard open so their action is unaffected.
 * Dropdown triggers are the exception: they blur the current text field before
 * opening, preventing the virtual keyboard from covering their options.
 */
export function DismissKeyboardOnOutsidePress() {
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      if (!isElement(event.target)) return;

      const target = event.target;
      const isFormField = Boolean(target.closest(FORM_FIELD_SELECTOR));
      if (isFormField || target.closest("label")) return;

      const isDropdown = Boolean(target.closest(DROPDOWN_SELECTOR));
      const isButton = Boolean(target.closest(BUTTON_SELECTOR));
      if (isButton && !isDropdown) return;

      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && isKeyboardField(activeElement)) {
        activeElement.blur();
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, []);

  return null;
}
