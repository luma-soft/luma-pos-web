import type { ServiceProjectListQuery } from "@/lib/data/services";

/** Service project list filters, shared by the services page and the phone load-more action. */
export type ServiceSearchParams = Record<string, string | undefined>;

export function serviceProjectsFilters(params: ServiceSearchParams): Pick<ServiceProjectListQuery, "status" | "serviceType" | "urgency" | "sort"> {
  const serviceType = params.type === "camera" || params.type === "electrical" || params.type === "plumbing" || params.type === "mixed" ? params.type : undefined;
  const status = params.status === "active" || params.status === "done" ? params.status : undefined;
  const urgency = params.urgency === "attention" || params.urgency === "overdue" ? params.urgency : undefined;
  const sort = params.sort === "starts_asc" || params.sort === "target_asc" || params.sort === "target_desc" ? params.sort : "starts_desc";
  return { status, serviceType, urgency, sort };
}
