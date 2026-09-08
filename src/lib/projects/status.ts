export type ReopenedServiceProjectState = {
  progressPercent: number;
  serviceStage: "active" | "completed" | "warranty";
};

export function shouldValidateServiceProjectClose(input: {
  currentStatus: string;
  nextStatus: string;
  isServiceProject: boolean;
}): boolean {
  return input.isServiceProject
    && input.currentStatus !== "done"
    && input.nextStatus === "done";
}

export function deriveReopenedServiceProjectState(input: {
  jobStatuses: readonly string[];
  warrantyClaimStatuses: readonly string[];
}): ReopenedServiceProjectState {
  const countableJobs = input.jobStatuses.filter(
    (status) => status !== "cancelled",
  );
  const completedJobs = countableJobs.filter(
    (status) => status === "completed",
  );
  const progressPercent = countableJobs.length === 0
    ? 0
    : Math.round((completedJobs.length / countableJobs.length) * 100);
  const hasOpenWarrantyClaim = input.warrantyClaimStatuses.some(
    (status) => status !== "closed" && status !== "void",
  );

  return {
    progressPercent,
    serviceStage: hasOpenWarrantyClaim
      ? "warranty"
      : countableJobs.length > 0 && completedJobs.length === countableJobs.length
        ? "completed"
        : "active",
  };
}
