export type ServiceProjectCloseSnapshot = {
  serviceType: "camera" | "electrical" | "plumbing" | "mixed";
  jobStatuses: string[];
  handoverDocuments: Array<{ type: string; status: string }>;
  dependencies: Array<{ status: string }>;
  coordinationPoints: Array<{
    status: string;
    isAcceptanceRequired: boolean;
  }>;
};

export type ServiceProjectCloseState = {
  canClose: boolean;
  incompleteJobs: number;
  coordinationBlockers: number;
  handoverSigned: boolean;
};

const terminalJobStatuses = new Set(["completed", "cancelled"]);
const terminalDependencyStatuses = new Set(["completed", "waived"]);
const terminalCoordinationStatuses = new Set(["resolved", "waived"]);

export function evaluateServiceProjectClose(
  snapshot: ServiceProjectCloseSnapshot,
): ServiceProjectCloseState {
  const incompleteJobs = snapshot.jobStatuses.filter(
    (status) => !terminalJobStatuses.has(status),
  ).length;
  const handoverSigned = snapshot.handoverDocuments.some(
    (document) => document.type === "handover" && document.status === "signed",
  );
  const coordinationBlockers = snapshot.serviceType === "mixed"
    ? snapshot.dependencies.filter(
      (dependency) => !terminalDependencyStatuses.has(dependency.status),
    ).length + snapshot.coordinationPoints.filter(
      (point) => point.isAcceptanceRequired
        && !terminalCoordinationStatuses.has(point.status),
    ).length
    : 0;

  return {
    canClose: incompleteJobs === 0
      && coordinationBlockers === 0
      && handoverSigned,
    incompleteJobs,
    coordinationBlockers,
    handoverSigned,
  };
}
