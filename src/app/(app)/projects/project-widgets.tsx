"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { PencilLine, Plus } from "lucide-react";
import { RowPreviewModal } from "@/components/data-table";
import { CustomerCreateDialog, type CustomerCreateResult } from "@/components/partners/customer-create-dialog";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import type { ProjectRow } from "@/lib/data/projects";
import { createProject, toggleProjectStatus, updateProject } from "@/lib/actions/extras";
import { createServiceProject } from "@/lib/actions/services";

export function ProjectQuickCreate({
  customers,
  serviceMode = false,
}: {
  customers: { id: string; name: string }[];
  serviceMode?: boolean;
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameSuggested, setNameSuggested] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [createdCustomers, setCreatedCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [serviceType, setServiceType] = useState("camera");
  const [targetEndsOn, setTargetEndsOn] = useState("");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const customerOptions = [
    ...customers,
    ...createdCustomers.filter((created) => !customers.some((customer) => customer.id === created.id)),
  ];

  function suggestProjectName(customerName: string, type = serviceType) {
    return `${customerName} - ${t(`services.types.${type}` as never)}`;
  }

  function chooseCustomer(nextCustomerId: string) {
    const customer = customerOptions.find((item) => item.id === nextCustomerId);
    setCustomerId(nextCustomerId);
    if (serviceMode && (!name.trim() || nameSuggested)) {
      setName(customer ? suggestProjectName(customer.name) : "");
      setNameSuggested(Boolean(customer));
    }
  }

  function chooseServiceType(nextServiceType: string) {
    setServiceType(nextServiceType);
    const customer = customerOptions.find((item) => item.id === customerId);
    if (serviceMode && nameSuggested && customer) {
      setName(suggestProjectName(customer.name, nextServiceType));
    }
  }

  function applyCreatedCustomer(customer: CustomerCreateResult) {
    setCreatedCustomers((current) => [...current.filter((item) => item.id !== customer.id), { id: customer.id, name: customer.name }]);
    setCustomerId(customer.id);
    if (serviceMode && (!name.trim() || nameSuggested)) {
      setName(suggestProjectName(customer.name));
      setNameSuggested(true);
    }
    setCustomerCreateOpen(false);
    router.refresh();
  }

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = serviceMode
      ? await createServiceProject({
          name,
          customerId: customerId || null,
          address: address || undefined,
          serviceType: serviceType as "camera" | "electrical" | "plumbing" | "mixed",
          targetEndsOn: targetEndsOn || null,
          note: note || undefined,
        })
      : await createProject({ name, customerId: customerId || null, address: address || undefined });
    setBusy(false);
    if (res.ok) {
      setOpen(false); setName(""); setAddress(""); setTargetEndsOn("");
      setNameSuggested(false); setCustomerId("");
      setNote("");
      router.refresh();
    } else setError(t(res.error as never));
  }

  return (
    <>
      <Button type="button" onClick={() => setOpen(true)} tx={serviceMode ? "services.projects.create" : "projects.createNew"}>
        <Plus className="w-4 h-4" />
      </Button>
      <RowPreviewModal
        open={open && !customerCreateOpen}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t(serviceMode ? "services.projects.create" : "projects.createNew")}
        closeLabel={t("common.close")}
        size="lg"
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={submit} disabled={busy || !name.trim()} loading={busy} tx="common.save" />
          </div>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("projects.cols.name")} required>
            <Input value={name} onChange={(e) => {
              setName(e.target.value);
              setNameSuggested(false);
            }} />
          </Field>
          <Field label={t("orders.cols.customer")}>
            <div className="flex min-w-0 gap-2">
            <Select
              value={customerId}
              onChange={(e) => chooseCustomer(e.target.value)}
              searchable
              searchPlaceholder={t("common.search")}
              options={[
                { value: "", label: t("projects.noCustomer") },
                ...customerOptions.map((c) => ({ value: c.id, label: c.name })),
              ]}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setCustomerCreateOpen(true)}
              title={t("customers.createNew")}
              aria-label={t("customers.createNew")}
            >
              <Plus />
            </Button>
            </div>
          </Field>
          <Field label={t("customers.fields.address")} className="sm:col-span-2">
            <Input value={address} onChange={(e) => setAddress(e.target.value)} />
          </Field>
          {serviceMode && (
            <>
              <Field label={t("services.fields.type")}><Select value={serviceType} onChange={(e) => chooseServiceType(e.target.value)} options={[{ value: "camera", label: t("services.types.camera") }, { value: "electrical", label: t("services.types.electrical") }, { value: "plumbing", label: t("services.types.plumbing") }, { value: "mixed", label: t("services.types.mixed") }]} rootClassName="w-full" /></Field>
              <Field label={t("services.fields.targetEndsOn")}><Input type="date" value={targetEndsOn} onChange={(e) => setTargetEndsOn(e.target.value)} /></Field>
              <Field label={t("customers.fields.note")} className="sm:col-span-2"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
            </>
          )}
          {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2" text={error} />}
        </div>
      </RowPreviewModal>
      <CustomerCreateDialog
        open={customerCreateOpen}
        onOpenChange={setCustomerCreateOpen}
        onCreated={applyCreatedCustomer}
      />
    </>
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
    <Button type="button" variant="link" size="sm" onClick={toggle} disabled={busy} className="h-auto px-0 text-xs min-h-11 min-w-11 lg:min-h-0 lg:min-w-0" text={status === "active" ? t("projects.markDone") : t("projects.reopen")} />
  );
}

type EditableProject = Pick<ProjectRow,
  | "id"
  | "name"
  | "customerId"
  | "address"
  | "note"
  | "status"
  | "serviceType"
  | "serviceStage"
  | "startsOn"
  | "targetEndsOn"
  | "siteContactName"
  | "siteContactPhone"
>;

export function ProjectEdit({
  project,
  customers,
  triggerVariant = "link",
}: {
  project: EditableProject;
  customers: { id: string; name: string }[];
  triggerVariant?: "link" | "outline" | "icon";
}) {
  const t = useTranslations();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [customerId, setCustomerId] = useState(project.customerId ?? "");
  const [createdCustomers, setCreatedCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [address, setAddress] = useState(project.address ?? "");
  const [note, setNote] = useState(project.note ?? "");
  const [status, setStatus] = useState(project.status);
  const [serviceType, setServiceType] = useState<string>(project.serviceType ?? "camera");
  const [targetEndsOn, setTargetEndsOn] = useState(project.targetEndsOn ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isServiceProject = Boolean(project.serviceType);
  const customerOptions = [
    ...customers,
    ...createdCustomers.filter((created) => !customers.some((customer) => customer.id === created.id)),
  ];

  function applyCreatedCustomer(customer: CustomerCreateResult) {
    setCreatedCustomers((current) => [...current.filter((item) => item.id !== customer.id), { id: customer.id, name: customer.name }]);
    setCustomerId(customer.id);
    setCustomerCreateOpen(false);
    router.refresh();
  }

  async function submit() {
    if (!name.trim() || busy) return;
    setBusy(true);
    setError("");
    const res = await updateProject({
      id: project.id,
      name,
      customerId: customerId || null,
      address: address || undefined,
      note: isServiceProject ? project.note ?? undefined : note,
      status: isServiceProject
        ? project.status === "done" ? "done" : "active"
        : status === "done" ? "done" : "active",
      serviceType: isServiceProject ? serviceType as "camera" | "electrical" | "plumbing" | "mixed" : undefined,
      serviceStage: isServiceProject ? project.serviceStage ?? undefined : undefined,
      startsOn: isServiceProject ? project.startsOn : undefined,
      targetEndsOn: isServiceProject ? targetEndsOn || null : undefined,
      siteContactName: isServiceProject ? project.siteContactName ?? undefined : undefined,
      siteContactPhone: isServiceProject ? project.siteContactPhone ?? undefined : undefined,
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
      {triggerVariant === "icon" ? (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => setOpen(true)}
          title={t("common.edit")}
          aria-label={t("common.edit")}
          className="rounded-xl bg-primary-50 text-primary-700 transition hover:-translate-y-0.5 hover:bg-primary-100"
        >
          <PencilLine className="h-4 w-4" />
        </Button>
      ) : (
        <Button
          type="button"
          variant={triggerVariant}
          size="sm"
          onClick={() => setOpen(true)}
          className={triggerVariant === "link" ? "h-auto px-0 text-xs min-h-11 min-w-11 lg:min-h-0 lg:min-w-0" : undefined}
          tx="common.edit"
        />
      )}
      <RowPreviewModal
        open={open && !customerCreateOpen}
        onClose={() => {
          if (!busy) setOpen(false);
        }}
        title={t("projects.editTitle")}
        closeLabel={t("common.close")}
        size={isServiceProject ? "lg" : "md"}
        footer={(
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy} tx="common.cancel" />
            <Button type="button" onClick={submit} disabled={busy || !name.trim()} loading={busy} tx="common.save" />
          </div>
        )}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t("projects.cols.name")} required><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t("orders.cols.customer")}>
            <div className="flex min-w-0 gap-2">
            <Select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
              searchable
              searchPlaceholder={t("common.search")}
              options={[
                { value: "", label: t("projects.noCustomer") },
                ...customerOptions.map((c) => ({ value: c.id, label: c.name })),
              ]}
              className="min-w-0 flex-1"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              onClick={() => setCustomerCreateOpen(true)}
              title={t("customers.createNew")}
              aria-label={t("customers.createNew")}
            >
              <Plus />
            </Button>
            </div>
          </Field>
          <Field label={t("customers.fields.address")} className="sm:col-span-2"><Input value={address} onChange={(e) => setAddress(e.target.value)} /></Field>
          {isServiceProject ? (
            <>
              <Field label={t("services.fields.type")}><Select value={serviceType} onChange={(e) => setServiceType(e.target.value)} options={[{ value: "camera", label: t("services.types.camera") }, { value: "electrical", label: t("services.types.electrical") }, { value: "plumbing", label: t("services.types.plumbing") }, { value: "mixed", label: t("services.types.mixed") }]} rootClassName="w-full" /></Field>
              <Field label={t("services.fields.targetEndsOn")}><Input type="date" value={targetEndsOn} onChange={(e) => setTargetEndsOn(e.target.value)} /></Field>
            </>
          ) : (
            <Field label={t("orders.cols.status")}><Select value={status} onChange={(e) => setStatus(e.target.value)} options={[{ value: "active", label: t("projects.status.active") }, { value: "done", label: t("projects.status.done") }]} /></Field>
          )}
          {!isServiceProject && (
            <Field label={t("customers.fields.note")} className="sm:col-span-2"><Textarea value={note} onChange={(e) => setNote(e.target.value)} /></Field>
          )}
          {error && <Text as="p" variant="destructive" size="xs" className="sm:col-span-2" text={error} />}
        </div>
      </RowPreviewModal>
      <CustomerCreateDialog
        open={customerCreateOpen}
        onOpenChange={setCustomerCreateOpen}
        onCreated={applyCreatedCustomer}
      />
    </>
  );
}
