"use client";

import { useEffect, useId, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useForm, useWatch, type FieldError } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useTranslations } from "next-intl";
import { AlertCircle, Eye, EyeOff, Loader2, Lock, Mail, Phone, X } from "lucide-react";
import { Routes } from "@/lib/routes";
import { ONLINE_SALES_ENABLED } from "@/lib/features";
import { LanguageSwitcher } from "@/components/language-switcher";
import { cn } from "@/lib/utils";

// Mirrors NativeLoginView.swift: one "Account" field accepts email or phone and
// the method is inferred from "@" (AuthCoordinator.loginMethod(for:)).
const loginSchema = z.object({
  identifier: z.string().trim().min(1, { error: "validation.required" }),
  password: z.string().min(6, { error: "validation.passwordTooShort" }),
}).superRefine((value, ctx) => {
  if (loginMethodFor(value.identifier) === "email") {
    if (!z.email().safeParse(value.identifier.trim()).success) {
      ctx.addIssue({ code: "custom", path: ["identifier"], message: "validation.email" });
    }
  } else if (!normalizePhone(value.identifier)) {
    ctx.addIssue({ code: "custom", path: ["identifier"], message: "validation.phone" });
  }
});

type LoginInput = z.infer<typeof loginSchema>;

export default function LoginPage() {
  const t = useTranslations();
  const router = useRouter();
  const [serverErr, setServerErr] = useState<string | null>(null);
  const [storeName, setStoreName] = useState<string | null>(null);
  const [passwordVisible, setPasswordVisible] = useState(false);
  const passwordRef = useRef<HTMLInputElement | null>(null);

  const form = useForm<LoginInput>({
    resolver: zodResolver(loginSchema),
    defaultValues: { identifier: "", password: "" },
  });
  const [identifier, password] = useWatch({ control: form.control, name: ["identifier", "password"] });
  const loginMethod = loginMethodFor(identifier ?? "");
  // Stay busy after a successful login until the next page has rendered:
  // router.push is not awaited, so isSubmitting alone ends too early.
  const [navigating, startNavigation] = useTransition();
  const submitting = form.formState.isSubmitting || navigating;
  const canSubmit = (identifier ?? "").trim().length > 0 && (password ?? "").length > 0;
  const { errors } = form.formState;

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
    const method = loginMethodFor(values.identifier);
    const body = method === "email"
      ? { email: values.identifier.trim().toLowerCase(), password: values.password }
      : { phone: normalizePhone(values.identifier), password: values.password };
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setServerErr(response.status === 401 ? t("auth.invalidAccountCredentials") : t("errors.serverError"));
        return;
      }
    } catch {
      setServerErr(t("errors.serverError"));
      return;
    }
    const nextRoute = ONLINE_SALES_ENABLED && method === "email" && values.identifier.trim().toLowerCase() === "review@lumapos.shop"
      ? `${Routes.OnlineSales}?tab=overview&channel=shopee`
      : Routes.Dashboard;
    startNavigation(() => {
      router.push(nextRoute);
      router.refresh();
    });
  }

  const identifierField = form.register("identifier", { onChange: () => setServerErr(null) });
  const passwordField = form.register("password", { onChange: () => setServerErr(null) });

  return (
    <div className="grid min-h-dvh bg-ios-grouped-bg font-ios text-ios-label lg:grid-cols-2">
      <div className="relative flex flex-col px-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-[calc(env(safe-area-inset-top)+0.75rem)] lg:items-center lg:justify-center lg:p-8">
        <div className="flex justify-end lg:absolute lg:right-8 lg:top-4">
          <LanguageSwitcher compact />
        </div>

        <div className="mx-auto w-full max-w-[500px] pt-5 lg:max-w-sm lg:pt-0">
          {/* Desktop keeps the store identity beside the hero; the native app shows none. */}
          <div className="mb-8 hidden items-center gap-3 lg:flex">
            <div className="grid size-11 place-items-center rounded-[14px] bg-ios-accent text-lg font-extrabold text-white">
              {(storeName || t("common.appName")).trim().charAt(0).toUpperCase() || "H"}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[17px] font-semibold leading-tight">{storeName || t("common.appName")}</p>
              <p className="truncate text-[13px] text-ios-label-secondary">{t("auth.brandTagline")}</p>
            </div>
          </div>

          <header className="mb-[22px] space-y-2.5">
            <h1 className="font-ios-rounded text-[34px] font-bold leading-[41px] tracking-[0.01em]">{t("auth.loginTitle")}</h1>
            <p className="text-[17px] leading-[22px] text-ios-label-secondary">{t("auth.loginLead")}</p>
          </header>

          {serverErr && (
            <div
              role="alert"
              className="mb-4 flex items-start gap-3 rounded-[14px] bg-ios-card px-4 py-3 shadow-[0_6px_20px_rgb(0_0_0/0.08)] ring-[0.5px] ring-ios-stroke"
            >
              <AlertCircle className="mt-px size-5 shrink-0 text-ios-red" aria-hidden="true" />
              <p className="min-w-0 flex-1 text-[15px] leading-5">{serverErr}</p>
              <button
                type="button"
                onClick={() => setServerErr(null)}
                aria-label={t("common.close")}
                className="-m-2 grid size-9 shrink-0 place-items-center rounded-full text-ios-label-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent"
              >
                <X className="size-4" aria-hidden="true" />
              </button>
            </div>
          )}

          <form onSubmit={form.handleSubmit(onSubmit)} noValidate>
            <div className="space-y-3">
              <IosField label={t("auth.account")} error={translateError(t, errors.identifier)}>
                {(id, describedBy) => (
                  <>
                    {loginMethod === "email"
                      ? <Mail className="size-5 shrink-0 text-ios-label-secondary" aria-hidden="true" />
                      : <Phone className="size-5 shrink-0 text-ios-label-secondary" aria-hidden="true" />}
                    <input
                      id={id}
                      type="text"
                      inputMode="email"
                      autoComplete="username"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="next"
                      placeholder={t("auth.accountPrompt")}
                      disabled={submitting}
                      aria-invalid={!!errors.identifier}
                      aria-describedby={describedBy}
                      className={inputClass}
                      {...identifierField}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          passwordRef.current?.focus();
                        }
                      }}
                    />
                  </>
                )}
              </IosField>

              <IosField label={t("auth.password")} error={translateError(t, errors.password)}>
                {(id, describedBy) => (
                  <>
                    <Lock className="size-5 shrink-0 text-ios-label-secondary" aria-hidden="true" />
                    <input
                      id={id}
                      type={passwordVisible ? "text" : "password"}
                      autoComplete="current-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      enterKeyHint="done"
                      placeholder={t("auth.passwordPrompt")}
                      disabled={submitting}
                      aria-invalid={!!errors.password}
                      aria-describedby={describedBy}
                      className={inputClass}
                      {...passwordField}
                      ref={(element) => {
                        passwordField.ref(element);
                        passwordRef.current = element;
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => setPasswordVisible((visible) => !visible)}
                      aria-label={t(passwordVisible ? "auth.hidePassword" : "auth.showPassword")}
                      className="-mr-2 grid size-11 shrink-0 place-items-center rounded-full text-ios-label-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent"
                    >
                      {passwordVisible
                        ? <EyeOff className="size-5" aria-hidden="true" />
                        : <Eye className="size-5" aria-hidden="true" />}
                    </button>
                  </>
                )}
              </IosField>
            </div>

            <button
              type="submit"
              disabled={submitting || !canSubmit}
              aria-busy={submitting}
              className={cn(
                "relative mt-4 flex h-[52px] w-full items-center justify-center rounded-[14px] bg-ios-accent text-[17px] font-semibold text-white transition-[opacity,transform] duration-150 ease-out active:scale-[0.985] active:opacity-80 disabled:active:scale-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ios-accent focus-visible:ring-offset-2 focus-visible:ring-offset-ios-grouped-bg",
                // Loading keeps the button at full strength so the spinner reads as progress, not a disabled state.
                submitting ? "cursor-progress" : "disabled:opacity-40",
              )}
            >
              {/* Loading keeps the label in layout (LumaLoadingButtonLabel) and centers a spinner over it. */}
              <span className={cn(submitting && "invisible")}>{t("auth.loginButton")}</span>
              {submitting && <Loader2 className="absolute size-5 animate-spin" aria-label={t("auth.loggingIn")} />}
            </button>
          </form>

          <p className="mt-5 hidden text-center text-xs text-ios-label-secondary lg:block">{t("auth.accountHint")}</p>
        </div>
      </div>

      {/* phải: ảnh hero (thay file public/login-hero.svg bằng ảnh của bạn) */}
      <div className="relative hidden bg-gradient-to-br from-primary-600 to-primary-400 lg:block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/login-hero.svg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      </div>
    </div>
  );
}

// LumaFormInputSurfaceModifier: 15pt text, 14pt inset, 48pt min height, 8pt continuous corners, hairline stroke.
const inputClass =
  "h-12 min-h-12 min-w-0 flex-1 border-0 bg-transparent p-0 text-[16px] text-ios-label caret-ios-accent outline-none placeholder:text-ios-label-tertiary disabled:opacity-60 lg:text-[15px]";

function IosField({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: (id: string, describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="flex min-h-[22px] items-center text-[14px] font-medium text-ios-label-secondary">
        {label}
      </label>
      {/* Like LumaInlineError, validation is reported by the message below; the surface keeps its hairline. */}
      <div className="flex min-h-12 items-center gap-3 rounded-lg bg-ios-card px-3.5 ring-[0.5px] ring-ios-stroke ring-inset transition-shadow focus-within:ring-[1.5px] focus-within:ring-ios-accent has-[:disabled]:bg-ios-card-disabled">
        {children(id, error ? errorId : undefined)}
      </div>
      {error && <p id={errorId} className="text-[13px] leading-[18px] text-ios-red">{error}</p>}
    </div>
  );
}

function translateError(t: ReturnType<typeof useTranslations>, error?: FieldError) {
  const message = error?.message;
  if (!message) return undefined;
  if (!message.includes(".") || message.includes(" ")) return message;
  try { return t(message); } catch { return message; }
}

function loginMethodFor(identifier: string): "email" | "phone" {
  return identifier.trim().includes("@") ? "email" : "phone";
}

function normalizePhone(value: string) {
  const compact = value.replace(/[\s().-]/g, "");
  if (/^0\d{9,10}$/.test(compact)) return `+84${compact.slice(1)}`;
  if (/^84\d{9,10}$/.test(compact)) return `+${compact}`;
  return /^\+[1-9]\d{7,14}$/.test(compact) ? compact : null;
}
