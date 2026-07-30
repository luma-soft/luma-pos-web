"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { LanguageSwitcher } from "@/components/language-switcher";
import {
  Button, Input, Form, FormField, Heading, Muted, Text,
} from "@/components/ui";

const loginSchema = z.object({
  method: z.enum(["email", "phone"]),
  identifier: z.string().trim().min(1, { error: "validation.required" }),
  password: z.string().min(6, { error: "validation.passwordTooShort" }),
}).superRefine((value, ctx) => {
  if (value.method === "email" && !z.email().safeParse(value.identifier).success) {
    ctx.addIssue({ code: "custom", path: ["identifier"], message: "validation.email" });
  }
  if (value.method === "phone" && !normalizePhone(value.identifier)) {
    ctx.addIssue({ code: "custom", path: ["identifier"], message: "validation.phone" });
  }
});

type LoginInput = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const supabase = createClient();
  const [serverErr, setServerErr] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { method: "email", identifier: "", password: "" },
  });
  const loginMethod = useWatch({ control: form.control, name: "method" });

  async function onSubmit(values: LoginInput) {
    setServerErr(null);
    const credentials = values.method === "email"
      ? { email: values.identifier.trim().toLowerCase(), password: values.password }
      : { phone: normalizePhone(values.identifier)!, password: values.password };
    const { error } = await supabase.auth.signInWithPassword(credentials);
    if (error) {
      setServerErr(error.message);
      return;
    }
    const nextRoute = ONLINE_SALES_ENABLED && values.method === "email" && values.identifier.trim().toLowerCase() === "review@lumapos.shop"
      ? `${Routes.OnlineSales}?tab=overview&channel=shopee`
      : Routes.Dashboard;
    router.push(nextRoute);
    router.refresh();
  }

  return (
    // split layout — theo design/login.html
    <div className="min-h-screen grid lg:grid-cols-2 bg-canvas">
      {/* trái: form */}
      <div className="flex items-center justify-center p-8 relative">
        <div className="absolute top-4 right-4 lg:right-8">
          <LanguageSwitcher />
        </div>

        <div className="w-full max-w-sm">
          <div className="flex items-center gap-3 mb-7">
            <div className="w-11 h-11 rounded-card grid place-items-center text-white text-lg font-extrabold bg-gradient-to-br from-primary-600 to-primary-400">
              S
            </div>
            <div>
              <Heading as="h1" size="lg" tx="common.appName" />
              <Muted size="sm" tx="auth.brandTagline" />
            </div>
          </div>

          <Heading as="h2" size="xl" tx="auth.loginTitle" />
          <Muted size="sm" className="mt-1 mb-6" tx="auth.loginSubtitle" />

          <Form form={form} onSubmit={onSubmit} className="space-y-4">
            <FormField name="method" labelTx="auth.loginMethod" required>
              {(field) => (
                <select
                  {...field}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  onChange={(event) => {
                    field.onChange(event);
                    form.setValue("identifier", "");
                  }}
                >
                  <option value="email">{t("auth.emailPassword")}</option>
                  <option value="phone">{t("auth.phonePassword")}</option>
                </select>
              )}
            </FormField>

            <FormField name="identifier" labelTx={loginMethod === "phone" ? "auth.phone" : "auth.email"} required>
              {(field) => <Input type={loginMethod === "phone" ? "tel" : "email"} autoComplete={loginMethod === "phone" ? "tel" : "email"} {...field} />}
            </FormField>

            <FormField name="password" labelTx="auth.password" required>
              {(field) => <Input type="password" autoComplete="current-password" {...field} />}
            </FormField>

            {serverErr && <Text variant="destructive" size="sm" as="div" text={serverErr} />}

            <Button
              type="submit"
              block
              size="lg"
              loading={form.formState.isSubmitting}
              tx={form.formState.isSubmitting ? "auth.loggingIn" : "auth.loginButton"}
            />
          </Form>

          <p className="text-xs text-slate-400 text-center mt-5">{t("auth.accountHint")}</p>
        </div>
      </div>

      {/* phải: ảnh hero (thay file public/login-hero.svg bằng ảnh của bạn) */}
      <div className="hidden lg:block relative bg-gradient-to-br from-primary-600 to-primary-400">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/login-hero.svg" alt="" className="absolute inset-0 w-full h-full object-cover" />
      </div>
    </div>
  );
}

function normalizePhone(value: string) {
  const compact = value.replace(/[\s().-]/g, "");
  if (/^0\d{9,10}$/.test(compact)) return `+84${compact.slice(1)}`;
  if (/^84\d{9,10}$/.test(compact)) return `+${compact}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}
