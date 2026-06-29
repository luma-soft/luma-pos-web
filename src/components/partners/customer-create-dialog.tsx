"use client";

import { useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button, Form, FormField, Heading, Input, NumberInput, Select, Textarea } from "@/components/ui";
import { createCustomer } from "@/lib/actions/partners";
import { createCustomerSchema, type CreateCustomerInput, type CreateCustomerOutput } from "@/lib/schemas/order";
import { cn } from "@/lib/utils";
import { AI_WORKFLOW_DRAFT_STORAGE_KEY } from "@/components/ai-assistant/utils";

type AiWorkflowDraft = {
  intent?: string;
  action?: { payload?: Record<string, unknown> };
};

export type CustomerCreateResult = {
  id: string;
  name: string;
  phone: string;
  type: CreateCustomerOutput["type"];
  debtLimit: number;
};

function defaultCustomerValues(): CreateCustomerInput {
  return { name: "", phone: "", address: "", type: "retail", taxCode: "", debtLimit: 0, note: "" };
}

function readAiCustomerDraft(): CreateCustomerInput | null {
  try {
    const raw = window.localStorage.getItem(AI_WORKFLOW_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw) as AiWorkflowDraft;
    if (draft.intent !== "create_customer") return null;
    const payload = draft.action?.payload ?? {};
    const type = payload.type === "wholesale" || payload.type === "contractor" || payload.type === "agent" ? payload.type : "retail";
    return {
      name: typeof payload.name === "string" ? payload.name : "",
      phone: typeof payload.phone === "string" ? payload.phone : "",
      address: typeof payload.address === "string" ? payload.address : "",
      type,
      taxCode: typeof payload.taxCode === "string" ? payload.taxCode : "",
      debtLimit: typeof payload.debtLimit === "number" ? payload.debtLimit : 0,
      note: typeof payload.note === "string" ? payload.note : "",
    };
  } catch {
    return null;
  }
}

export function CustomerCreateForm({
  aiPreview = false,
  onCancel,
  onCreated,
  className,
}: {
  aiPreview?: boolean;
  onCancel: () => void;
  onCreated: (customer: CustomerCreateResult) => void;
  className?: string;
}) {
  const t = useTranslations();
  const form = useForm<CreateCustomerInput, unknown, CreateCustomerOutput>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: defaultCustomerValues(),
  });

  useEffect(() => {
    if (!aiPreview) return;
    const draft = readAiCustomerDraft();
    if (draft) form.reset(draft);
  }, [aiPreview, form]);

  async function onSubmit(values: CreateCustomerOutput) {
    const res = await createCustomer(values);
    if (res.ok) {
      onCreated({
        id: res.data.id,
        name: values.name.trim(),
        phone: values.phone?.trim() ?? "",
        type: values.type,
        debtLimit: values.debtLimit,
      });
      form.reset(defaultCustomerValues());
    } else {
      form.setError("root", { message: res.error });
    }
  }

  return (
    <Form form={form} onSubmit={onSubmit} className={cn("space-y-4", className)}>
      <FormField name="name" labelTx="customers.fields.name" required>
        {(field) => <Input {...field} placeholderTx="customers.fields.namePlaceholder" />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="phone" labelTx="customers.cols.phone">
          {(field) => <Input {...field} />}
        </FormField>
        <FormField name="type" labelTx="customers.cols.type">
          {(field) => (
            <Select
              {...field}
              options={(["retail", "wholesale", "contractor", "agent"] as const).map((v) => ({
                value: v,
                label: t(`customers.types.${v}`),
              }))}
            />
          )}
        </FormField>
      </div>
      <FormField name="address" labelTx="customers.fields.address">
        {(field) => <Input {...field} />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="taxCode" labelTx="customers.fields.taxCode">
          {(field) => <Input {...field} />}
        </FormField>
        <FormField name="debtLimit" labelTx="customers.fields.debtLimit" hintTx="customers.fields.debtLimitHint">
          {(field) => (
            <NumberInput value={field.value ?? 0} onChange={(v) => field.onChange(v ?? 0)} suffix="đ" min={0} />
          )}
        </FormField>
      </div>
      <FormField name="note" labelTx="customers.fields.note">
        {(field) => <Textarea {...field} rows={2} />}
      </FormField>

      {form.formState.errors.root && (
        <p className="text-sm text-er">{t(form.formState.errors.root.message ?? "errors.serverError")}</p>
      )}

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="outline" onClick={onCancel} tx="common.cancel" />
        <Button type="submit" loading={form.formState.isSubmitting} tx="common.save" />
      </div>
    </Form>
  );
}

export function CustomerCreateDialog({
  open,
  onOpenChange,
  onCreated,
  aiPreview = false,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: CustomerCreateResult) => void;
  aiPreview?: boolean;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-create-dialog-title"
        className="max-h-[min(92dvh,760px)] w-full overflow-auto rounded-t-2xl border border-border bg-surface p-4 shadow-e2 sm:max-w-2xl sm:rounded-card sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <Heading id="customer-create-dialog-title" as="h2" size="base" tx="customers.createNew" />
          <Button type="button" variant="ghost" size="iconSm" onClick={() => onOpenChange(false)} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CustomerCreateForm aiPreview={aiPreview} onCancel={() => onOpenChange(false)} onCreated={onCreated} />
      </div>
    </div>
  );
}
