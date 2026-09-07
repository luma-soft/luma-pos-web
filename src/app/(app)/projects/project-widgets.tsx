"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { PencilLine, Plus } from "lucide-react";
import { RowPreviewModal } from "@/components/data-table";
import { useConfirmDialog } from "@/components/confirm-dialog-provider";
import { CustomerCreateDialog, type CustomerCreateResult } from "@/components/partners/customer-create-dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field } from "@/components/ui/label";
import { Input, Textarea } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Text } from "@/components/ui/text";
import type { ProjectRow } from "@/lib/data/projects";
import { createProject, toggleProjectStatus, updateProject } from "@/lib/actions/extras";
import { createServiceProject } from "@/lib/actions/services";
import { projectScheduleState } from "@/lib/projects/schedule";
import { Routes } from "@/lib/routes";

export function ProjectQuickCreate({
  customers,
  serviceMode = false,
}: {
  customers: { id: string; name: string }[];
  serviceMode?: boolean;
}) {
  const t = useTranslations();
  const locale = useLocale();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [nameSuggested, setNameSuggested] = useState(false);
  const [customerId, setCustomerId] = useState("");
  const [createdCustomers, setCreatedCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [serviceType, setServiceType] = useState("camera");
  const [startsOn, setStartsOn] = useState("");
  const [targetEndsOn, setTargetEndsOn] = useState("");
  const [completed, setCompleted] = useState(false);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const customerOptions = [
    ...customers,
    ...createdCustomers.filter((created) => !customers.some((customer) => customer.id === created.id)),
  ];
  const schedule = projectScheduleState({ startsOn, targetEndsOn, completed });
  const scheduleOrderError = locale === "vi"
    ? "Ngày kết thúc dự kiến phải bằng hoặc sau ngày bắt đầu."
    : "The target completion date must be on or after the start date.";
  const pastTargetWarning = locale === "vi"
    ? "Ngày này đã qua. Công trình sẽ hiển thị Quá hạn."
    : "This date has passed. The project will appear as Overdue.";
  const completionHint = locale === "vi"
    ? "Bật khi công trình đã thi công xong."
    : "Turn on when project work is finished.";

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
    if (serviceMode && schedule.orderInvalid) {
      setError("");
      return;
    }
    setBusy(true);
    setError("");
    const res = serviceMode
      ? await createServiceProject({
          name,
          customerId: customerId || null,
          address: address || undefined,
          serviceType: serviceType as "camera" | "electrical" | "plumbing" | "mixed",
          startsOn: startsOn || null,
          targetEndsOn: targetEndsOn || null,
          note: note || undefined,
          status: completed ? "done" : "active",
          serviceStage: completed ? "completed" : "planning",
        })
      : await createProject({ name, customerId: customerId || null, address: address || undefined });
    setBusy(false);
    if (res.ok) {
      setOpen(false); setName(""); setAddress(""); setStartsOn(""); setTargetEndsOn("");
      setNameSuggested(false); setCustomerId("");
      setNote(""); setCompleted(false);
      if (serviceMode && res.data?.id) {
        router.push(Routes.project(res.data.id));
      } else {
        router.refresh();
      }
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
              <Field label={t("services.fields.startsOn")}><Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></Field>
              <Field label={t("services.fields.targetEndsOn")} className="sm:col-span-2">
                <Input type="date" value={targetEndsOn} onChange={(e) => setTargetEndsOn(e.target.value)} aria-invalid={schedule.orderInvalid} />
                {schedule.orderInvalid && <Text as="p" variant="destructive" size="xs" className="mt-1" text={scheduleOrderError} />}
                {!schedule.orderInvalid && schedule.targetInPast && <p className="mt-1 text-xs font-medium text-amber-700">{pastTargetWarning}</p>}
              </Field>
              <label className="flex min-h-18 cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 sm:col-span-2">
                <span>
                  <span className="block text-sm font-semibold">{t("projects.status.done")}</span>
                  <span className="mt-1 block text-xs text-slate-500">{completionHint}</span>
                </span>
                <Checkbox checked={completed} onChange={(event) => setCompleted(event.target.checked)} className="size-5" />
              </label>
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
  const locale = useLocale();
  const router = useRouter();
  const { alert, confirm } = useConfirmDialog();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    if (status !== "active") {
      const approved = await confirm({
        title: locale === "vi" ? "Mở lại công trình?" : "Reopen this project?",
        description: locale === "vi"
          ? "Trạng thái hoàn thành sẽ được gỡ và tiến độ được tính lại theo lệnh việc hiện có."
          : "Completion will be removed and progress recalculated from the current work orders.",
        confirmLabel: t("projects.reopen"),
        variant: "warning",
      });
      if (!approved) return;
    }
    setBusy(true);
    const res = await toggleProjectStatus(id);
    setBusy(false);
    if (res.ok) {
      router.refresh();
      return;
    }
    await alert({
      title: t("common.error"),
      description: res.error === "services.errors.projectCloseBlocked"
        ? t("services.errors.projectCloseBlocked")
        : t("errors.serverError"),
      variant: "warning",
    });
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
  const locale = useLocale();
  const router = useRouter();
  const { confirm } = useConfirmDialog();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(project.name);
  const [customerId, setCustomerId] = useState(project.customerId ?? "");
  const [createdCustomers, setCreatedCustomers] = useState<{ id: string; name: string }[]>([]);
  const [customerCreateOpen, setCustomerCreateOpen] = useState(false);
  const [address, setAddress] = useState(project.address ?? "");
  const [note, setNote] = useState(project.note ?? "");
  const [status, setStatus] = useState(project.status);
  const [serviceType, setServiceType] = useState<string>(project.serviceType ?? "camera");
  const [startsOn, setStartsOn] = useState(project.startsOn ?? "");
  const [targetEndsOn, setTargetEndsOn] = useState(project.targetEndsOn ?? "");
  const [completed, setCompleted] = useState(project.status === "done");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const isServiceProject = Boolean(project.serviceType);
  const customerOptions = [
    ...customers,
    ...createdCustomers.filter((created) => !customers.some((customer) => customer.id === created.id)),
  ];
  const schedule = projectScheduleState({ startsOn, targetEndsOn, completed });
  const scheduleOrderError = locale === "vi"
    ? "Ngày kết thúc dự kiến phải bằng hoặc sau ngày bắt đầu."
    : "The target completion date must be on or after the start date.";
  const pastTargetWarning = locale === "vi"
    ? "Ngày này đã qua. Công trình sẽ hiển thị Quá hạn."
    : "This date has passed. The project will appear as Overdue.";
  const completionHint = locale === "vi"
    ? "Bật khi công trình đã thi công xong."
    : "Turn on when project work is finished.";

  function applyCreatedCustomer(customer: CustomerCreateResult) {
    setCreatedCustomers((current) => [...current.filter((item) => item.id !== customer.id), { id: customer.id, name: customer.name }]);
    setCustomerId(customer.id);
    setCustomerCreateOpen(false);
    router.refresh();
  }

  async function submit() {
    if (!name.trim() || busy) return;
    if (isServiceProject && schedule.orderInvalid) {
      setError("");
      return;
    }
    if (isServiceProject && project.status === "done" && !completed) {
      const approved = await confirm({
        title: locale === "vi" ? "Mở lại công trình?" : "Reopen this project?",
        description: locale === "vi"
          ? "Trạng thái hoàn thành sẽ được gỡ và tiến độ được tính lại theo lệnh việc hiện có."
          : "Completion will be removed and progress recalculated from the current work orders.",
        confirmLabel: t("projects.reopen"),
        variant: "warning",
      });
      if (!approved) return;
    }
    setBusy(true);
    setError("");
    const res = await updateProject({
      id: project.id,
      name,
      customerId: customerId || null,
      address: address || undefined,
      note: isServiceProject ? project.note ?? undefined : note,
      status: isServiceProject
        ? completed ? "done" : "active"
        : status === "done" ? "done" : "active",
      serviceType: isServiceProject ? serviceType as "camera" | "electrical" | "plumbing" | "mixed" : undefined,
      serviceStage: isServiceProject ? completed ? "completed" : project.serviceStage ?? undefined : undefined,
      startsOn: isServiceProject ? startsOn || null : undefined,
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
              <Field label={t("services.fields.startsOn")}><Input type="date" value={startsOn} onChange={(e) => setStartsOn(e.target.value)} /></Field>
              <Field label={t("services.fields.targetEndsOn")} className="sm:col-span-2">
                <Input type="date" value={targetEndsOn} onChange={(e) => setTargetEndsOn(e.target.value)} aria-invalid={schedule.orderInvalid} />
                {schedule.orderInvalid && <Text as="p" variant="destructive" size="xs" className="mt-1" text={scheduleOrderError} />}
                {!schedule.orderInvalid && schedule.targetInPast && <p className="mt-1 text-xs font-medium text-amber-700">{pastTargetWarning}</p>}
              </Field>
              <label className="flex min-h-18 cursor-pointer items-center justify-between gap-4 rounded-xl border border-border bg-surface px-4 py-3 sm:col-span-2">
                <span>
                  <span className="block text-sm font-semibold">{t("projects.status.done")}</span>
                  <span className="mt-1 block text-xs text-slate-500">{completionHint}</span>
                </span>
                <Checkbox checked={completed} onChange={(event) => setCompleted(event.target.checked)} className="size-5" />
              </label>
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
