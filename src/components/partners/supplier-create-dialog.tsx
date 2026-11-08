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
  mobileDialogActions = false,
}: {
  onCancel: () => void;
  onCreated: (supplier: SupplierCreateResult) => void;
  className?: string;
  mobileDialogActions?: boolean;
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

      <div className={cn(
        "flex justify-end gap-2 pt-2",
        mobileDialogActions && "sticky bottom-0 z-10 -mx-4 border-t border-border-soft bg-surface px-4 py-3 pb-[calc(.75rem+env(safe-area-inset-bottom))] lg:static lg:mx-0 lg:border-t-0 lg:bg-transparent lg:px-0 lg:pb-0",
      )}>
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
  const t = useTranslations();
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 lg:items-center lg:p-4" role="presentation">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-create-dialog-title"
        className="h-dvh w-full overflow-y-auto overscroll-contain border border-border bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] shadow-e2 lg:h-auto lg:max-h-[min(92dvh,760px)] lg:max-w-2xl lg:rounded-card lg:p-6"
      >
        <div className="sticky top-0 z-10 mb-4 flex items-center justify-between gap-3 border-b border-border-soft bg-surface py-2 lg:static lg:border-b-0 lg:py-0">
          <Heading id="supplier-create-dialog-title" as="h2" size="base" tx="suppliers.createNew" />
          <Button type="button" variant="ghost" size="iconSm" onClick={() => onOpenChange(false)} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <SupplierCreateForm onCancel={() => onOpenChange(false)} onCreated={onCreated} mobileDialogActions />
      </div>
    </div>
  );
}
