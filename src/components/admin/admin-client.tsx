"use client";

import { useCallback, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw, ServerCog, UserPlus, UsersRound } from "lucide-react";
import { STAFF_ROLES, type Role } from "@/lib/auth/roles";
import { AdminOperationsPanel } from "@/components/admin/admin-operations-panel";

type Account = {
  id: string;
  fullName: string;
  phone: string | null;
  email: string | null;
  role: Role;
  isActive: boolean;
  mustResetPassword: boolean | null;
  activeSessions: number;
};

async function readEnvelope<T>(response: Response): Promise<T> {
  const body = await response.json() as { ok?: boolean; data?: T };
  if (!response.ok || !body.ok || body.data === undefined) throw new Error("REQUEST_FAILED");
  return body.data;
}

export function AdminClient({ canManageOperations }: { canManageOperations: boolean }) {
  const t = useTranslations("admin");
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [section, setSection] = useState<"operations" | "accounts">(canManageOperations ? "operations" : "accounts");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState(false);
  const [roleTarget, setRoleTarget] = useState<string | null>(null);
  const [passwords, setPasswords] = useState<Record<string, string>>({});
  const [newRole, setNewRole] = useState<Role>("cashier");

  const load = useCallback(async () => {
    setError(false);
    setLoading(true);
    try {
      const accountResult = await fetch("/api/admin/accounts", { cache: "no-store" });
      setAccounts(await readEnvelope<Account[]>(accountResult));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(initialLoad);
  }, [load]);

  const mutate = async (path: string, method: string, body?: unknown) => {
    setBusy(true);
    setNotice("");
    try {
      const response = await fetch(path, {
        method,
        headers: body ? { "content-type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      await readEnvelope(response);
      setNotice(t("saved"));
      await load();
      return true;
    } catch {
      setError(true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const createAccount = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const body = Object.fromEntries(form.entries());
    if (await mutate("/api/admin/accounts", "POST", { ...body, role: newRole })) {
      formElement.reset();
      setNewRole("cashier");
      setNotice(t("created"));
    }
  };

  const displayRole = (role: Role) => t(`roles.${role}`);
  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 pb-8 sm:p-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{t("title")}</h1>
          <p className="mt-1 text-sm text-slate-500">{t("subtitle")}</p>
        </div>
        {section === "accounts" && <button type="button" onClick={() => void load()} disabled={busy || loading} className="inline-flex h-10 shrink-0 items-center gap-2 rounded-lg border border-border px-3 text-sm font-medium transition hover:bg-surface-2 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 disabled:opacity-50">
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />{t("refresh")}
        </button>}
      </header>

      {canManageOperations && (
        <nav aria-label={t("adminSections")} className="flex w-fit max-w-full items-center gap-1 rounded-xl border border-border bg-surface p-1">
          {([
            { id: "operations" as const, label: t("backendLocalTitle"), Icon: ServerCog },
            { id: "accounts" as const, label: t("accounts"), Icon: UsersRound },
          ]).map(({ id, label, Icon }) => (
            <button key={id} type="button" aria-pressed={section === id} onClick={() => setSection(id)} className={`inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-semibold transition active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 ${section === id ? "bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300" : "text-slate-500 hover:bg-surface-2 hover:text-slate-900 dark:hover:text-slate-100"}`}>
              <Icon className="h-4 w-4" />{label}
            </button>
          ))}
        </nav>
      )}

      {section === "accounts" && error && <p role="alert" className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-700 dark:bg-red-950/30 dark:text-red-300">{t("genericError")}</p>}
      {section === "accounts" && notice && <p role="status" className="rounded-lg bg-emerald-50 px-4 py-3 text-sm text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300">{notice}</p>}

      {section === "accounts" ? <section className="rounded-2xl border border-border bg-surface p-4 sm:p-5">
        <div className="mb-4 flex items-center gap-2">
          <UserPlus className="h-5 w-5 text-primary-600" />
          <h2 className="text-lg font-semibold">{t("accounts")}</h2>
        </div>

        <form onSubmit={createAccount} className="grid gap-3 rounded-xl bg-surface-2 p-4 md:grid-cols-2">
          <label className="grid gap-1 text-sm font-medium">
            {t("fullName")}
            <input name="fullName" required minLength={2} maxLength={120} className="h-10 rounded-lg border border-border bg-surface px-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            {t("email")}
            <input name="email" type="email" autoComplete="off" className="h-10 rounded-lg border border-border bg-surface px-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            {t("phone")}
            <input name="phone" type="tel" autoComplete="off" className="h-10 rounded-lg border border-border bg-surface px-3" />
          </label>
          <label className="grid gap-1 text-sm font-medium">
            {t("password")}
            <input name="password" type="password" minLength={8} required autoComplete="new-password" className="h-10 rounded-lg border border-border bg-surface px-3" />
          </label>
          <div className="md:col-span-2">
            <p className="mb-2 text-sm font-medium">{t("role")}</p>
            <div className="flex flex-wrap gap-2">
              {STAFF_ROLES.filter((role) => canManageOperations || role !== "owner").map((role) => (
                <button key={role} type="button" aria-pressed={newRole === role} onClick={() => setNewRole(role)} className={`rounded-full border px-3 py-1.5 text-sm ${newRole === role ? "border-primary-600 bg-primary-50 text-primary-700 dark:bg-primary-950/40 dark:text-primary-300" : "border-border text-slate-600 dark:text-slate-300"}`}>
                  {displayRole(role)}
                </button>
              ))}
            </div>
          </div>
          <p className="text-xs text-slate-500 md:col-span-2">{t("contactHint")}</p>
          <div className="md:col-span-2">
            <button disabled={busy} className="h-10 rounded-lg bg-primary-600 px-4 text-sm font-semibold text-white hover:bg-primary-700 disabled:opacity-50">{t("createAccount")}</button>
          </div>
        </form>

        <div className="mt-4 divide-y divide-border">
          {loading ? <div className="space-y-3 py-5" aria-label={t("loading")}><div className="h-4 w-1/3 animate-pulse rounded bg-surface-2" /><div className="h-4 w-2/3 animate-pulse rounded bg-surface-2" /></div> : accounts.length === 0 ? <p className="py-5 text-sm text-slate-500">{t("emptyAccounts")}</p> : accounts.map((account) => (
            <article key={account.id} className="grid gap-3 py-4 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="font-semibold">{account.fullName}</h3>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${account.isActive ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-300" : "bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300"}`}>
                    {account.isActive ? t("active") : t("inactive")}
                  </span>
                  {account.mustResetPassword && <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-800">{t("resetPassword")}</span>}
                </div>
                <p className="mt-1 truncate text-sm text-slate-500">{account.email || account.phone || account.id}</p>
                <p className="mt-1 text-xs text-slate-500">{displayRole(account.role)} · {account.activeSessions} {t("sessions")}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" disabled={busy} onClick={() => void mutate("/api/admin/accounts", "PATCH", { id: account.id, isActive: !account.isActive })} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-surface-2">
                  {account.isActive ? t("deactivate") : t("activate")}
                </button>
                <button type="button" disabled={busy || account.activeSessions === 0} onClick={() => void mutate(`/api/admin/accounts/${account.id}/sessions`, "POST")} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-surface-2 disabled:opacity-50">
                  {t("revokeSessions")}
                </button>
                {canManageOperations && (
                  <div className="flex items-center gap-2">
                    <input
                      aria-label={`${t("password")}: ${account.fullName}`}
                      type="password"
                      value={passwords[account.id] ?? ""}
                      onChange={(event) => setPasswords((current) => ({ ...current, [account.id]: event.target.value }))}
                      className="h-9 w-36 rounded-lg border border-border bg-surface px-2 text-xs"
                    />
                    <button type="button" disabled={busy || !passwords[account.id]} onClick={async () => {
                      const done = await mutate("/api/admin/accounts", "PATCH", { id: account.id, password: passwords[account.id] });
                      if (done) setPasswords((current) => ({ ...current, [account.id]: "" }));
                    }} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-surface-2 disabled:opacity-50">
                      {t("resetPassword")}
                    </button>
                  </div>
                )}
                <button type="button" onClick={() => setRoleTarget(roleTarget === account.id ? null : account.id)} className="rounded-lg border border-border px-3 py-2 text-xs font-medium hover:bg-surface-2">
                  {t("changeRole")}
                </button>
              </div>
              {roleTarget === account.id && (
                <div className="flex flex-wrap gap-2 lg:col-span-2">
                  {STAFF_ROLES.filter((role) => canManageOperations || role !== "owner").map((role) => (
                    <button key={role} type="button" aria-pressed={account.role === role} disabled={busy || account.role === role} onClick={() => void mutate("/api/admin/accounts", "PATCH", { id: account.id, role })} className={`rounded-full border px-3 py-1.5 text-xs ${account.role === role ? "border-primary-600 bg-primary-50 text-primary-700" : "border-border hover:bg-surface-2"}`}>
                      {displayRole(role)}
                    </button>
                  ))}
                </div>
              )}
            </article>
          ))}
        </div>
      </section> : <AdminOperationsPanel />}
    </div>
  );
}
