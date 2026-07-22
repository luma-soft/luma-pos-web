"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import { RowPreviewModal } from "@/components/data-table";
import { CustomerCreateDialog, type CustomerCreateResult } from "@/components/partners/customer-create-dialog";
import { Button } from "@/components/ui/button";
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
  const [customerId, setCustomerId] = useState("");
  const [createdCustomers, setCreatedCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [serviceType, setServiceType] = useState("camera");
  const [targetEndsOn, setTargetEndsOn] = useState("");
  const [siteContactName, setSiteContactName] = useState("");
  const [siteContactPhone, setSiteContactPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
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
    const res = serviceMode
      ? await createServiceProject({
          name,
          customerId: customerId || null,
          address: address || undefined,
          serviceType: serviceType as "camera" | "electrical" | "plumbing" | "mixed",
          targetEndsOn: targetEndsOn || null,
          siteContactName: siteContactName || undefined,
          siteContactPhone: siteContactPhone || undefined,
        })
      : await createProject({ name, customerId: customerId || null, address: address || undefined });
    setBusy(false);
    if (res.ok) {
      setOpen(false); setName(""); setAddress(""); setTargetEndsOn("");
      setSiteContactName(""); setSiteContactPhone("");
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
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t("projects.cols.name")} *`} />
          <div className="flex min-w-0 gap-2">
            <Select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
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
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("customers.fields.address")} className="sm:col-span-2" />
          {serviceMode && (
            <>
              <Select
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                options={[
                  { value: "camera", label: t("services.types.camera") },
                  { value: "electrical", label: t("services.types.electrical") },
                  { value: "plumbing", label: t("services.types.plumbing") },
                  { value: "mixed", label: t("services.types.mixed") },
                ]}
              />
              <Input type="date" value={targetEndsOn} onChange={(e) => setTargetEndsOn(e.target.value)} aria-label={t("services.fields.targetEndsOn")} />
              <Input value={siteContactName} onChange={(e) => setSiteContactName(e.target.value)} placeholder={t("services.fields.siteContactName")} />
              <Input value={siteContactPhone} onChange={(e) => setSiteContactPhone(e.target.value)} placeholder={t("services.fields.siteContactPhone")} />
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
    <Button type="button" variant="link" size="sm" onClick={toggle} disabled={busy} className="h-auto px-0 text-xs" text={status === "active" ? t("projects.markDone") : t("projects.reopen")} />
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

export function ProjectEdit({ project, customers }: { project: EditableProject; customers: { id: string; name: string }[] }) {
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
  const [serviceStage, setServiceStage] = useState<string>(project.serviceStage ?? "planning");
  const [startsOn, setStartsOn] = useState(project.startsOn ?? "");
  const [targetEndsOn, setTargetEndsOn] = useState(project.targetEndsOn ?? "");
  const [siteContactName, setSiteContactName] = useState(project.siteContactName ?? "");
  const [siteContactPhone, setSiteContactPhone] = useState(project.siteContactPhone ?? "");
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
      note: note || undefined,
      status: isServiceProject
        ? serviceStage === "completed" || serviceStage === "cancelled" ? "done" : "active"
        : status === "done" ? "done" : "active",
      serviceType: isServiceProject ? serviceType as "camera" | "electrical" | "plumbing" | "mixed" : undefined,
      serviceStage: isServiceProject ? serviceStage as "planning" | "quoted" | "active" | "paused" | "completed" | "warranty" | "cancelled" : undefined,
      startsOn: isServiceProject ? startsOn || null : undefined,
      targetEndsOn: isServiceProject ? targetEndsOn || null : undefined,
      siteContactName: isServiceProject ? siteContactName || undefined : undefined,
      siteContactPhone: isServiceProject ? siteContactPhone || undefined : undefined,
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
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={`${t("projects.cols.name")} *`} />
          <div className="flex min-w-0 gap-2">
            <Select
              value={customerId}
              onChange={(e) => setCustomerId(e.target.value)}
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
          <Input value={address} onChange={(e) => setAddress(e.target.value)} placeholder={t("customers.fields.address")} className="sm:col-span-2" />
          {isServiceProject ? (
            <>
              <Select
                value={serviceType}
                onChange={(e) => setServiceType(e.target.value)}
                options={[
                  { value: "camera", label: t("services.types.camera") },
                  { value: "electrical", label: t("services.types.electrical") },
                  { value: "plumbing", label: t("services.types.plumbing") },
                  { value: "mixed", label: t("services.types.mixed") },
                ]}
              />
              <Select
                value={serviceStage}
                onChange={(e) => setServiceStage(e.target.value)}
                options={["planning", "quoted", "active", "paused", "completed", "warranty", "cancelled"].map((value) => ({
                  value,
                  label: t(`services.stages.${value}` as never),
                }))}
              />
              <Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} aria-label={t("services.fields.startsOn")} />
              <Input type="date" value={targetEndsOn} onChange={(e) => setTargetEndsOn(e.target.value)} aria-label={t("services.fields.targetEndsOn")} />
              <Input value={siteContactName} onChange={(e) => setSiteContactName(e.target.value)} placeholder={t("services.fields.siteContactName")} />
              <Input value={siteContactPhone} onChange={(e) => setSiteContactPhone(e.target.value)} placeholder={t("services.fields.siteContactPhone")} />
            </>
          ) : (
            <Select
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              options={[
                { value: "active", label: t("projects.status.active") },
                { value: "done", label: t("projects.status.done") },
              ]}
            />
          )}
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("customers.fields.note")} className="sm:col-span-2" />
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
