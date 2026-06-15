"use client";

import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { ArrowLeft } from "lucide-react";
import { Form, FormField, Input, NumberInput, Select, Button, Textarea, Heading } from "@/components/ui";
import { Routes } from "@/lib/routes";
import { createCustomer } from "@/lib/actions/partners";
import { createCustomerSchema, type CreateCustomerInput, type CreateCustomerOutput } from "@/lib/schemas/order";

export function CustomerForm() {
  const t = useTranslations();
  const router = useRouter();

  const form = useForm<CreateCustomerInput, unknown, CreateCustomerOutput>({
    resolver: zodResolver(createCustomerSchema),
    defaultValues: { name: "", phone: "", address: "", type: "retail", taxCode: "", debtLimit: 0, note: "" },
  });

  async function onSubmit(values: CreateCustomerOutput) {
    const res = await createCustomer(values);
    if (res.ok) router.push(Routes.Customers);
    else form.setError("root", { message: res.error });
  }

  return (
    <div className="p-6 max-w-2xl">
      <div className="flex items-center gap-3 mb-6">
        <Button type="button" variant="ghost" size="iconSm" onClick={() => router.push(Routes.Customers)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Heading as="h1" size="lg" tx="customers.createNew" />
      </div>

      <Form form={form} onSubmit={onSubmit} className="bg-surface border border-border rounded-card p-6 space-y-4">
        <FormField name="name" labelTx="customers.fields.name" required>
          {(field) => <Input {...field} placeholderTx="customers.fields.namePlaceholder" />}
        </FormField>
        <div className="grid grid-cols-2 gap-4">
          <FormField name="phone" labelTx="customers.cols.phone">
            {(field) => <Input {...field} />}
          </FormField>
          <FormField name="type" labelTx="customers.cols.type">
            {(field) => (
              <Select
                {...field}
                options={(["retail", "wholesale", "contractor", "agent"] as const).map((v) => ({
                  value: v, label: t(`customers.types.${v}`),
                }))}
              />
            )}
          </FormField>
        </div>
        <FormField name="address" labelTx="customers.fields.address">
          {(field) => <Input {...field} />}
        </FormField>
        <div className="grid grid-cols-2 gap-4">
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
          <Button type="button" variant="outline" onClick={() => router.push(Routes.Customers)} tx="common.cancel" />
          <Button type="submit" loading={form.formState.isSubmitting} tx="common.save" />
        </div>
      </Form>
    </div>
  );
}
