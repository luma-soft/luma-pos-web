"use client";

import { useEffect, useRef } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { X } from "lucide-react";
import { Button, Form, FormField, Heading, Input, MoneyInput, Select, Textarea } from "@/components/ui";
import { createCustomer } from "@/lib/actions/partners";
import { createCustomerSchema, type CreateCustomerInput, type CreateCustomerOutput } from "@/lib/schemas/order";
import { cn } from "@/lib/utils";
import { AI_WORKFLOW_DRAFT_STORAGE_KEY, tenantStorageKey } from "@/components/ai-assistant/utils";
import { useTenantClientScope } from "@/components/tenant-client-scope";
import type { ActionResult } from "@/lib/actions/common";
import { VietnamAddressFields } from "@/components/addresses/vietnam-address-fields";
import { MobileFormHeader, mobileFormSectionTitle } from "@/components/mobile-form-header";
import { useModalLayer } from "@/components/ui/use-modal-layer";

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

type CreateCustomerAction = (
  input: CreateCustomerOutput,
) => Promise<ActionResult<{ id: string }>>;

function defaultCustomerValues(): CreateCustomerInput {
  return {
    name: "", phone: "", email: "", zaloUserId: "", address: "", addressLine: "",
    addressProvinceCode: "", addressWardCode: "", type: "retail",
    taxCode: "", debtLimit: 0, note: "", consentStatus: "pending",
    consentPurposes: {}, consentSource: "web",
  };
}

function readAiCustomerDraft(storageScope: string): CreateCustomerInput | null {
  try {
    const raw = window.localStorage.getItem(tenantStorageKey(AI_WORKFLOW_DRAFT_STORAGE_KEY, storageScope));
    if (!raw) return null;
    const draft = JSON.parse(raw) as AiWorkflowDraft;
    if (draft.intent !== "create_customer") return null;
    const payload = draft.action?.payload ?? {};
    const type = payload.type === "wholesale" || payload.type === "contractor" || payload.type === "agent" ? payload.type : "retail";
    return {
      name: typeof payload.name === "string" ? payload.name : "",
      phone: typeof payload.phone === "string" ? payload.phone : "",
      email: typeof payload.email === "string" ? payload.email : "",
      zaloUserId: typeof payload.zaloUserId === "string" ? payload.zaloUserId : "",
      address: typeof payload.address === "string" ? payload.address : "",
      addressLine: typeof payload.addressLine === "string"
        ? payload.addressLine
        : typeof payload.address === "string" ? payload.address : "",
      addressProvinceCode: typeof payload.addressProvinceCode === "string" ? payload.addressProvinceCode : "",
      addressWardCode: typeof payload.addressWardCode === "string" ? payload.addressWardCode : "",
      type,
      taxCode: typeof payload.taxCode === "string" ? payload.taxCode : "",
      debtLimit: typeof payload.debtLimit === "number" ? payload.debtLimit : 0,
      note: typeof payload.note === "string" ? payload.note : "",
      consentStatus: "pending",
      consentPurposes: {},
      consentSource: "web",
    };
  } catch {
    return null;
  }
}

export function CustomerCreateForm({
  aiPreview = false,
  createAction = createCustomer,
  onCancel,
  onCreated,
  className,
  mobileDialogActions = false,
  id,
}: {
  id?: string;
  aiPreview?: boolean;
  createAction?: CreateCustomerAction;
  onCancel: () => void;
  onCreated: (customer: CustomerCreateResult) => void;
  className?: string;
  mobileDialogActions?: boolean;
}) {
  const t = useTranslations();
  const storageScope = useTenantClientScope();
  const form = useForm<CreateCustomerInput, unknown, CreateCustomerOutput>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: defaultCustomerValues(),
  });

  useEffect(() => {
    if (!aiPreview) return;
    const draft = readAiCustomerDraft(storageScope);
    if (draft) form.reset(draft);
  }, [aiPreview, form, storageScope]);

  async function onSubmit(values: CreateCustomerOutput) {
    const consentPurposes: Record<string, boolean> = values.consentStatus === "granted"
      ? { sales: true, loyalty: false, marketing: false, analytics: false }
      : {};
    const res = await createAction({ ...values, consentPurposes });
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
    <Form id={id} form={form} onSubmit={onSubmit} className={cn("space-y-4", mobileDialogActions && "max-lg:flex max-lg:flex-col max-lg:gap-3 max-lg:space-y-0", className)}>
      {mobileDialogActions && <h3 className={cn(mobileFormSectionTitle, "order-0")}>{t("mobile.customers.editor.contact")}</h3>}
      <FormField name="name" labelTx="customers.fields.name" required>
        {(field) => <Input {...field} placeholderTx="customers.fields.namePlaceholder" />}
      </FormField>
      <div className="grid gap-4 sm:grid-cols-2 max-lg:contents">
        <FormField name="phone" labelTx="customers.cols.phone">
          {(field) => <Input {...field} />}
        </FormField>
        <div className="max-lg:order-6">
        <FormField name="type" labelTx="customers.cols.type">
          {(field) => (
            <Select
              {...field}
              rootClassName="max-lg:block max-lg:w-full"
              className="max-lg:w-full"
              options={(["retail", "wholesale", "contractor", "agent"] as const).map((v) => ({
                value: v,
                label: t(`customers.types.${v}`),
              }))}
            />
          )}
        </FormField>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 max-lg:contents">
        <FormField name="email" labelTx="customers.fields.email">
          {(field) => <Input {...field} type="email" />}
        </FormField>
        <FormField name="zaloUserId" labelTx="customers.fields.zaloUserId">
          {(field) => <Input {...field} />}
        </FormField>
      </div>
      <VietnamAddressFields
        idPrefix="customer-create-address"
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
      {mobileDialogActions && <h3 className={cn(mobileFormSectionTitle, "order-5 pt-2")}>{t("mobile.customers.editor.relationship")}</h3>}
      {mobileDialogActions && <h3 className={cn(mobileFormSectionTitle, "order-8 pt-2")}>{t("mobile.customers.editor.additional")}</h3>}
      <div className="grid gap-4 sm:grid-cols-2 max-lg:contents">
        <div className="max-lg:order-9">
        <FormField name="taxCode" labelTx="customers.fields.taxCode">
          {(field) => <Input {...field} />}
        </FormField>
        </div>
        <div className="max-lg:order-7">
        <FormField name="debtLimit" labelTx="customers.fields.debtLimit" hintTx="customers.fields.debtLimitHint">
          {(field) => (
            <MoneyInput value={field.value ?? 0} onChange={(v) => field.onChange(v ?? 0)} suffix="đ" min={0} />
          )}
        </FormField>
        </div>
      </div>
      <div className="max-lg:order-10">
      <FormField name="note" labelTx="customers.fields.note">
        {(field) => <Textarea {...field} rows={2} />}
      </FormField>
      </div>
      <div className="max-lg:order-11">
      <FormField name="consentStatus" labelTx="customers.fields.consentStatus">
        {(field) => (
          <Select
            {...field}
            options={[
              { value: "pending", label: t("customers.consent.pending") },
              { value: "granted", label: t("customers.consent.granted") },
            ]}
          />
        )}
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

export function CustomerCreateDialog({
  open,
  onOpenChange,
  onCreated,
  aiPreview = false,
  createAction = createCustomer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (customer: CustomerCreateResult) => void;
  aiPreview?: boolean;
  createAction?: CreateCustomerAction;
}) {
  const t = useTranslations();
  const dialogRef = useRef<HTMLDivElement>(null);
  useModalLayer({ open, onEscape: () => onOpenChange(false), elementRef: dialogRef });
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-end justify-center bg-black/40 p-0 lg:items-center lg:p-4" role="presentation">
      <div ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="customer-create-dialog-title"
        className="h-dvh w-full overflow-y-auto overscroll-contain border border-border bg-surface px-4 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(1rem+env(safe-area-inset-top))] shadow-e2 max-lg:border-0 max-lg:bg-canvas max-lg:px-0 max-lg:pt-0 lg:h-auto lg:max-h-[min(92dvh,760px)] lg:max-w-2xl lg:rounded-card lg:p-6"
      >
        {/* Phones: NativeCustomerEditorView presented full screen. */}
        <MobileFormHeader
          title={t("mobile.customers.editor.createTitle")}
          onCancel={() => onOpenChange(false)}
          submitLabel={t("mobile.customers.editor.create")}
          formId="customer-create-form"
        />
        <div className="sticky top-0 z-10 mb-4 flex items-center justify-between gap-3 border-b border-border-soft bg-surface py-2 max-lg:hidden lg:static lg:border-b-0 lg:py-0">
          <Heading id="customer-create-dialog-title" as="h2" size="base" tx="customers.createNew" />
          <Button type="button" variant="ghost" size="iconSm" onClick={() => onOpenChange(false)} aria-label={t("common.close")}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <CustomerCreateForm
          aiPreview={aiPreview}
          createAction={createAction}
          onCancel={() => onOpenChange(false)}
          onCreated={onCreated}
          mobileDialogActions
          id="customer-create-form"
          className="max-lg:px-ios-inset max-lg:pt-ios-section"
        />
      </div>
    </div>
  );
}
