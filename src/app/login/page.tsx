"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { Mail, Phone } from "lucide-react";
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
  const [storeName, setStoreName] = useState<string | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { method: "phone", identifier: "", password: "" },
  });
  const loginMethod = useWatch({ control: form.control, name: "method" });

  useEffect(() => {
    void fetch("/api/public/store", { cache: "no-store" })
      .then((response) => response.ok ? response.json() : null)
      .then((data: { name?: unknown } | null) => {
        if (typeof data?.name === "string" && data.name.trim()) {
          setStoreName(data.name.trim());
        }
      })
      .catch(() => undefined);
  }, []);

  async function onSubmit(values: LoginInput) {
    setServerErr(null);
    const { error } = values.method === "email"
      ? await supabase.auth.signInWithPassword({
          email: values.identifier.trim().toLowerCase(),
          password: values.password,
        })
      : await signInWithInternalPhone({
          phone: normalizePhone(values.identifier)!,
          password: values.password,
          supabase,
        });
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
              H
            </div>
            <div>
              <Heading as="h1" size="lg" text={storeName || t("common.appName")} />
              <Muted size="sm" tx="auth.brandTagline" />
            </div>
          </div>

          <Heading as="h2" size="xl" className="mb-6" tx="auth.loginTitle" />

          <Form form={form} onSubmit={onSubmit} className="space-y-4">
            <FormField name="identifier" labelTx={loginMethod === "phone" ? "auth.phone" : "auth.email"} required>
              {(field) => (
                <div className="relative">
                  <Input
                    type={loginMethod === "phone" ? "tel" : "email"}
                    autoComplete={loginMethod === "phone" ? "tel" : "email"}
                    leftIcon={loginMethod === "phone" ? <Phone /> : <Mail />}
                    className="pr-12"
                    {...field}
                  />
                  <button
                    type="button"
                    className="absolute right-1.5 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-md text-slate-500 transition-colors hover:bg-slate-100 hover:text-primary-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-600 dark:hover:bg-slate-800"
                    title={t(loginMethod === "phone" ? "auth.useEmail" : "auth.usePhone")}
                    aria-label={t(loginMethod === "phone" ? "auth.useEmail" : "auth.usePhone")}
                    onClick={() => {
                      form.setValue("method", loginMethod === "phone" ? "email" : "phone");
                      form.setValue("identifier", "");
                      form.clearErrors("identifier");
                    }}
                  >
                    {loginMethod === "phone" ? <Mail size={17} /> : <Phone size={17} />}
                  </button>
                </div>
              )}
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

async function signInWithInternalPhone({
  phone,
  password,
  supabase,
}: {
  phone: string;
  password: string;
  supabase: ReturnType<typeof createClient>;
}) {
  const response = await fetch("/api/mobile/auth/login", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phone, password }),
  });
  const body = await response.json().catch(() => null) as {
    ok?: boolean;
    data?: { accessToken?: string; refreshToken?: string };
  } | null;
  if (!response.ok || !body?.ok || !body.data?.accessToken || !body.data.refreshToken) {
    return { error: new Error("Invalid login credentials") };
  }
  return supabase.auth.setSession({
    access_token: body.data.accessToken,
    refresh_token: body.data.refreshToken,
  });
}
