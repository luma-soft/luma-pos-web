"use client";

import { useRef } from "react";

import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { X } from "lucide-react";
import { useTranslations } from "next-intl";
import { Button, Form, FormField, Heading, Input, Textarea } from "@/components/ui";
import { createSupplier, updateSupplier } from "@/lib/actions/partners";
import { createSupplierSchema, type CreateSupplierInput, type CreateSupplierOutput } from "@/lib/schemas/order";
import { cn } from "@/lib/utils";
import { VietnamAddressFields } from "@/components/addresses/vietnam-address-fields";
import { MobileFormHeader, mobileFormSectionTitle } from "@/components/mobile-form-header";
import { useModalLayer } from "@/components/ui/use-modal-layer";

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
  id,
  onCancel,
  onCreated,
  className,
  mobileDialogActions = false,
  editingId,
  initialValues,
}: {
  id?: string;
  onCancel: () => void;
  onCreated: (supplier: SupplierCreateResult) => void;
  className?: string;
  /** Phones: NativeSupplierFormView sections, Save lives in the header. */
  mobileDialogActions?: boolean;
  /** Edit an existing supplier instead of creating one. */
  editingId?: string;
  initialValues?: Partial<CreateSupplierInput>;
}) {
  const t = useTranslations();
  const form = useForm<CreateSupplierInput, unknown, CreateSupplierOutput>({
    resolver: zodResolver(createSupplierSchema),
    defaultValues: { ...defaultSupplierValues(), ...initialValues },
  });

  async function onSubmit(values: CreateSupplierOutput) {
    const res = editingId
      ? await updateSupplier({ id: editingId, ...values })
      : await createSupplier(values);
    if (res.ok) {
      onCreated({
        id: editingId ?? (res.data as { id: string }).id,
        name: values.name.trim(),
        phone: values.phone?.trim() ?? "",
      });
      if (!editingId) form.reset(defaultSupplierValues());
    } else {
      form.setError("root", { message: res.error });
    }
  }

  const sectionTitle = (key: "basic" | "tax" | "contact" | "additional", order: string) =>
    mobileDialogActions && <h3 className={cn(mobileFormSectionTitle, order, key !== "basic" && "pt-2")}>{t(`mobile.suppliers.editor.${key}`)}</h3>;

  return (
    <Form id={id} form={form} onSubmit={onSubmit} className={cn("space-y-4", mobileDialogActions && "max-lg:flex max-lg:flex-col max-lg:gap-3 max-lg:space-y-0", className)}>
      {sectionTitle("basic", "order-0")}
      <div className="max-lg:order-1">
        <FormField name="name" labelTx="suppliers.fields.name" required>
          {(field) => <Input {...field} placeholderTx="suppliers.fields.namePlaceholder" />}
        </FormField>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 max-lg:contents">
        <div className="max-lg:order-2">
          <FormField name="phone" labelTx="customers.cols.phone">
            {(field) => <Input {...field} type="tel" />}
          </FormField>
        </div>
        <div className="max-lg:order-3">
          <FormField name="email" labelTx="customers.fields.email">
            {(field) => <Input {...field} type="email" />}
          </FormField>
        </div>
      </div>
      {sectionTitle("contact", "order-6")}
      <div className="max-lg:order-7">
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
      </div>
      {sectionTitle("tax", "order-4")}
      <div className="max-lg:order-5">
        <FormField name="taxCode" labelTx="customers.fields.taxCode">
          {(field) => <Input {...field} />}
        </FormField>
      </div>
      {sectionTitle("additional", "order-8")}
      <div className="max-lg:order-9">
        <FormField name="note" labelTx="customers.fields.note">
          {(field) => <Textarea {...field} rows={2} />}
        </FormField>
      </div>

      {form.formState.errors.root && (
        <p className="text-sm text-er max-lg:order-first">{t(form.formState.errors.root.message ?? "errors.serverError")}</p>
      )}

      <div className={cn(
        "flex justify-end gap-2 pt-2",
        mobileDialogActions && "max-lg:hidden",
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
  editingId,
  initialValues,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (supplier: SupplierCreateResult) => void;
  /** Opens the same form to edit this supplier. */
  editingId?: string;
  initialValues?: Partial<CreateSupplierInput>;
}) {
  const t = useTranslations();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalLayer({ open, onEscape: () => onOpenChange(false), elementRef: dialogRef });
  if (!open) return null;
  const formId = editingId ? "supplier-edit-form" : "supplier-create-form";

  return (
    <div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/40 p-0 lg:items-center lg:p-4" role="presentation">
      <div ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="supplier-create-dialog-title"
        className="h-dvh w-full overflow-y-auto overscroll-contain border border-border bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] shadow-e2 max-lg:border-0 max-lg:bg-canvas max-lg:px-0 max-lg:pt-0 lg:h-auto lg:max-h-[min(92dvh,760px)] lg:max-w-2xl lg:rounded-card lg:p-6"
      >
        {/* Phones: NativeSupplierFormView presented full screen. */}
        <MobileFormHeader
          title={t(editingId ? "mobile.suppliers.edit" : "mobile.suppliers.add")}
          onCancel={() => onOpenChange(false)}
          submitLabel={t(editingId ? "common.save" : "mobile.suppliers.create")}
          formId={formId}
        />
        <div className="sticky top-0 z-10 mb-4 flex items-center justify-between gap-3 border-b border-border-soft bg-surface py-2 max-lg:hidden lg:static lg:border-b-0 lg:py-0">
          <Heading id="supplier-create-dialog-title" as="h2" size="base" tx={editingId ? "common.edit" : "suppliers.createNew"} />
          <Button type="button" variant="ghost" size="iconSm" onClick={() => onOpenChange(false)} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <SupplierCreateForm
          id={formId}
          onCancel={() => onOpenChange(false)}
          onCreated={onCreated}
          mobileDialogActions
          editingId={editingId}
          initialValues={initialValues}
          className="max-lg:px-ios-inset max-lg:pt-ios-section"
        />
      </div>
    </div>
  );
}
