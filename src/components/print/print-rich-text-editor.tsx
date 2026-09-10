"use client";

import { useEffect, useRef, type ClipboardEvent, type ReactElement } from "react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Heading3, Italic, List, ListOrdered, Pilcrow, Underline } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { sanitizePrintRichText } from "@/lib/print/rich-text";

interface Props {
  value: string;
  onChange: (value: string) => void;
  className?: string;
}

export function PrintRichTextEditor({ value, onChange, className }: Props) {
  const t = useTranslations("printSettings.richText");
  const editorRef = useRef<HTMLDivElement>(null);
  const lastEmitted = useRef("");

  useEffect(() => {
    const editor = editorRef.current;
    if (!editor || value === lastEmitted.current) return;
    editor.innerHTML = sanitizePrintRichText(value);
  }, [value]);

  function emit() {
    const editor = editorRef.current;
    if (!editor) return;
    const next = sanitizePrintRichText(editor.innerHTML);
    lastEmitted.current = next;
    onChange(next);
  }

  function run(command: string, argument?: string) {
    const editor = editorRef.current;
    if (!editor) return;
    editor.focus();
    document.execCommand(command, false, argument);
    emit();
  }

  function handleInput() {
    emit();
  }

  function handlePaste(event: ClipboardEvent<HTMLDivElement>) {
    event.preventDefault();
    document.execCommand("insertText", false, event.clipboardData.getData("text/plain"));
    emit();
  }

  function handleBlur() {
    const editor = editorRef.current;
    if (!editor) return;
    const clean = sanitizePrintRichText(editor.innerHTML);
    editor.innerHTML = clean;
    lastEmitted.current = clean;
    onChange(clean);
  }

  return (
    <div className={cn("overflow-hidden rounded-lg border border-border bg-surface", className)}>
      <div className="flex flex-wrap gap-1 border-b border-border-soft bg-surface-2 p-1.5" role="toolbar" aria-label={t("toolbar")}>
        <ToolButton label={t("paragraph")} onPress={() => run("formatBlock", "p")}><Pilcrow /></ToolButton>
        <ToolButton label={t("heading")} onPress={() => run("formatBlock", "h3")}><Heading3 /></ToolButton>
        <span className="mx-0.5 w-px bg-border" aria-hidden="true" />
        <ToolButton label={t("bold")} onPress={() => run("bold")}><Bold /></ToolButton>
        <ToolButton label={t("italic")} onPress={() => run("italic")}><Italic /></ToolButton>
        <ToolButton label={t("underline")} onPress={() => run("underline")}><Underline /></ToolButton>
        <span className="mx-0.5 w-px bg-border" aria-hidden="true" />
        <ToolButton label={t("bulletList")} onPress={() => run("insertUnorderedList")}><List /></ToolButton>
        <ToolButton label={t("numberedList")} onPress={() => run("insertOrderedList")}><ListOrdered /></ToolButton>
        <span className="mx-0.5 w-px bg-border" aria-hidden="true" />
        <ToolButton label={t("alignLeft")} onPress={() => run("justifyLeft")}><AlignLeft /></ToolButton>
        <ToolButton label={t("alignCenter")} onPress={() => run("justifyCenter")}><AlignCenter /></ToolButton>
        <ToolButton label={t("alignRight")} onPress={() => run("justifyRight")}><AlignRight /></ToolButton>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        role="textbox"
        aria-multiline="true"
        aria-label={t("editor")}
        data-placeholder={t("placeholder")}
        onInput={handleInput}
        onPaste={handlePaste}
        onBlur={handleBlur}
        className="min-h-36 whitespace-pre-wrap px-3 py-2.5 text-sm outline-none empty:before:pointer-events-none empty:before:text-slate-400 empty:before:content-[attr(data-placeholder)] [&_h3]:my-1 [&_h3]:text-base [&_h3]:font-bold [&_ol]:list-decimal [&_ol]:pl-5 [&_p]:my-1 [&_ul]:list-disc [&_ul]:pl-5"
      />
    </div>
  );
}

function ToolButton({ label, onPress, children }: { label: string; onPress: () => void; children: ReactElement<{ className?: string }> }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onMouseDown={(event) => event.preventDefault()}
      onClick={onPress}
      className="inline-flex h-9 w-9 items-center justify-center rounded-md text-slate-600 hover:bg-surface hover:text-slate-950 focus-visible:outline-2 focus-visible:outline-primary-500 dark:text-slate-300 dark:hover:text-white [&_svg]:h-4 [&_svg]:w-4"
    >
      {children}
    </button>
  );
}
