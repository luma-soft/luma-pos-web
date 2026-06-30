"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import type { ProjectRow } from "@/lib/data/projects";
import { createProject, toggleProjectStatus, updateProject } from "@/lib/actions/extras";

export function ProjectQuickCreate({ customers }: { customers: { id: string; name: string }[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [address, setAddress] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await createProject({ name, customerId: customerId || null, address: address || undefined });
    setBusy(false);
    if (res.ok) {
      setOpen(false); setName(""); setAddress("");
      router.refresh();
    } else setError(t(res.error as never));
  }

  if (!open) {
    return (
      <Button type="button" onClick={() => setOpen(true)} tx="projects.createNew">
        <Plus className="w-4 h-4" />
      </Button>
    );
  }

  return (
    <div className="flex items-end gap-2 bg-surface border border-border rounded-card p-3 flex-wrap">
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t("projects.cols.name")} *`} className="w-52" />
      <Select
        value={customerId}
        onChange={(e) => setCustomerId(e.target.value)}
        options={[
          { value: "", label: t("projects.noCustomer") },
          ...customers.map((c) => ({ value: c.id, label: c.name })),
        ]}
      />
      <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("customers.fields.address")} className="w-52" />
      <Button type="button" onClick={submit} disabled={busy || !name.trim()} loading={busy} tx="common.save" />
      <Button type="button" variant="ghost" size="iconSm" onClick={() => setOpen(false)}><X className="w-4 h-4" /></Button>
      {error && <Text as="p" variant="destructive" size="xs" className="w-full" text={error} />}
    </div>
  );
}

export function ProjectToggle({ id, status }: { id: string; status: string }) {
  const t = useTranslations();
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    setBusy(true);
    const res = await toggleProjectStatus(id);
    setBusy(false);
    if (res.ok) router.refresh();
  }

  return (
    <Button type="button" variant="link" size="sm" onClick={toggle} disabled={busy} className="h-auto px-0 text-xs" text={status === "active" ? t("projects.markDone") : t("projects.reopen")} />
  );
}

export function ProjectEdit({ project, customers }: { project: ProjectRow; customers: { id: string; name: string }[] }) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [customerId, setCustomerId] = useState(project.customerId ?? "");
  const [address, setAddress] = useState(project.address ?? "");
  const [note, setNote] = useState(project.note ?? "");
  const [status, setStatus] = useState(project.status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await updateProject({
      id: project.id,
      name,
      customerId: customerId || null,
      address: address || undefined,
      note: note || undefined,
      status: status === "done" ? "done" : "active",
    });
    setBusy(false);
    if (res.ok) {
      setOpen(false);
      router.refresh();
    } else {
      setError(t(res.error as never));
    }
  }

  return (
    <>
      <Button type="button" variant="link" size="sm" onClick={() => setOpen(true)} className="h-auto px-0 text-xs" tx="common.edit" />
      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4" onClick={() => setOpen(false)}>
          <div className="w-full max-w-xl rounded-card border border-border bg-surface p-4 shadow-e2" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <Text as="h2" weight="bold" className="text-sm" tx="projects.editTitle" />
              <Button type="button" variant="ghost" size="iconSm" onClick={() => setOpen(false)}><X className="w-4 h-4" /></Button>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t("projects.cols.name")} *`} />
              <Select
                value={customerId}
                onChange={(e) => setCustomerId(e.target.value)}
                options={[
                  { value: "", label: t("projects.noCustomer") },
                  ...customers.map((c) => ({ value: c.id, label: c.name })),
                ]}
              />
              <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("customers.fields.address")} />
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                options={[
                  { value: "active", label: t("projects.status.active") },
                  { value: "done", label: t("projects.status.done") },
                ]}
              />
              <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("customers.fields.note")} className="sm:col-span-2" />
            </div>
            {error && <Text as="p" variant="destructive" size="xs" className="mt-3" text={error} />}
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} tx="common.cancel" />
              <Button type="button" onClick={submit} disabled={busy || !name.trim()} loading={busy} tx="common.save" />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
