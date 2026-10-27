"use client";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Form, FormField, Heading, Input, Textarea } from "@/components/ui";
import { createSupplier } from "@/lib/actions/partners";
import { createSupplierSchema, type CreateSupplierInput, type CreateSupplierOutput } from "@/lib/schemas/order";
import { cn } from "@/lib/utils";
import { VietnamAddressFields } from "@/components/addresses/vietnam-address-fields";

export type SupplierCreateResult = {
  id: string;
  name: string;
  phone: string;
};

function defaultSupplierValues(): CreateSupplierInput {
  return {
    name: "", phone: "", email: "", address: "", addressLine: "",
    addressProvinceCode: "", addressWardCode: "", taxCode: "", note: "",
  };
}

export function SupplierCreateForm({
  onCancel,
  onCreated,
  className,
}: {
  onCancel: () => void;
  onCreated: (supplier: SupplierCreateResult) => void;
  className?: string;
}) {
  const t = useTranslations();
  const form = useForm<CreateSupplierInput, unknown, CreateSupplierOutput>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: defaultSupplierValues(),
  });

  async function onSubmit(values: CreateSupplierOutput) {
    const res = await createSupplier(values);
    if (res.ok) {
      onCreated({
        id: res.data.id,
        name: values.name.trim(),
        phone: values.phone?.trim() ?? "",
      });
      form.reset(defaultSupplierValues());
    } else {
      form.setError("root", { message: res.error });
    }
  }

  return (
    <Form form={form} onSubmit={onSubmit} className={cn("space-y-4", className)}>
      <FormField name="name" labelTx="suppliers.fields.name" required>
        {(field) => <Input {...field} placeholderTx="suppliers.fields.namePlaceholder" />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField name="phone" labelTx="customers.cols.phone">
          {(field) => <Input {...field} />}
        </FormField>
        <FormField name="email" labelTx="customers.fields.email">
          {(field) => <Input {...field} type="email" />}
        </FormField>
      </div>
      <VietnamAddressFields
        idPrefix="supplier-create-address"
        className="sm:col-span-2"
        value={{
          addressLine: form.watch("addressLine") ?? "",
          addressProvinceCode: form.watch("addressProvinceCode") ?? "",
          addressWardCode: form.watch("addressWardCode") ?? "",
        }}
        onChange={(value) => {
          form.setValue("addressLine", value.addressLine, { shouldDirty: true });
          form.setValue("addressProvinceCode", value.addressProvinceCode, { shouldDirty: true });
          form.setValue("addressWardCode", value.addressWardCode, { shouldDirty: true });
        }}
      />
      <FormField name="taxCode" labelTx="customers.fields.taxCode">
        {(field) => <Input {...field} />}
      </FormField>
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

export function SupplierCreateDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (supplier: SupplierCreateResult) => void;
}) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-create-dialog-title"
        className="max-h-[min(92dvh,760px)] w-full overflow-auto rounded-t-2xl border border-border bg-surface p-4 shadow-e2 sm:max-w-2xl sm:rounded-card sm:p-6"
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <Heading id="supplier-create-dialog-title" as="h2" size="base" tx="suppliers.createNew" />
          <Button type="button" variant="ghost" size="iconSm" onClick={() => onOpenChange(false)} title="Close">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <SupplierCreateForm onCancel={() => onOpenChange(false)} onCreated={onCreated} />
      </div>
    </div>
  );
}
