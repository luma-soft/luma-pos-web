import { mobileError, mobileOk } from "@/lib/mobile/response";

export function isServiceSnapshotJobLocked(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      current instanceof Error
      && current.message.includes("SERVICE_SIGNED_SNAPSHOT_JOB_LOCKED")
    ) return true;
    current = typeof current === "object" && "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return false;
}

export function isServiceFieldJobTerminal(error: unknown) {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (
      current instanceof Error
      && current.message.includes("SERVICE_FIELD_JOB_TERMINAL")
    ) return true;
    current = typeof current === "object" && "cause" in current
      ? (current as { cause?: unknown }).cause
      : null;
  }
  return false;
}

export function serviceSnapshotMutationErrorKey(error: unknown) {
  return isServiceSnapshotJobLocked(error)
    ? "services.errors.signedSnapshotLocked"
    : "errors.serverError";
}

export async function mobileFieldOperation<T>(operation: () => Promise<T>) {
  try {
    return mobileOk(await operation());
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message === "SERVICE_JOB_NOT_FOUND" || message === "SERVICE_JOB_FORBIDDEN") {
      return mobileError("errors.notFound", 404);
    }
    if (message === "SERVICE_ACTIVE_VISIT_NOT_FOUND") {
      return mobileError("services.errors.activeVisitNotFound", 409);
    }
    if (message === "SERVICE_ACTIVE_VISIT_EXISTS") {
      return mobileError("services.errors.invalidTransition", 409);
    }
    if (message === "SERVICE_ACTIVE_TIME_ENTRY_NOT_FOUND") {
      return mobileError("services.errors.activeVisitNotFound", 409);
    }
    if (message === "SERVICE_TIME_ENTRY_VISIT_INVALID") {
      return mobileError("services.errors.invalidTransition", 409);
    }
    if (message === "SERVICE_CHECKLIST_MISMATCH") {
      return mobileError("services.errors.checklistMismatch", 409);
    }
    if (message === "SERVICE_SIGNATURE_ATTACHMENT_INVALID") {
      return mobileError("services.errors.signatureAttachmentInvalid", 409);
    }
    if (message === "SERVICE_SIGNATURE_STALE") {
      return mobileError("services.errors.signatureStale", 409);
    }
    if (
      message === "SERVICE_SIGNATURE_HASH_INVALID"
      || message === "SERVICE_SIGNATURE_OWNERSHIP_INVALID"
    ) {
      return mobileError("services.errors.signatureIntegrityInvalid", 409);
    }
    if (message === "SERVICE_ATTACHMENT_SIGNED") {
      return mobileError("services.errors.attachmentSigned", 409);
    }
    if (message === "SERVICE_ATTACHMENT_JOB_LOCKED") {
      return mobileError("services.errors.invalidTransition", 409);
    }
    if (message === "SERVICE_ATTACHMENT_NOT_FOUND" || message === "SERVICE_ATTACHMENT_FORBIDDEN") {
      return mobileError("errors.notFound", 404);
    }
    if (message === "SERVICE_MATERIAL_NOT_FOUND") {
      return mobileError("errors.notFound", 404);
    }
    if (
      message === "SERVICE_COMPLETION_STATUS_INVALID"
      || message === "SERVICE_VISIT_STATUS_INVALID"
      || message === "SERVICE_COMPLETION_OPEN_WORK"
      || isServiceFieldJobTerminal(error)
    ) {
      return mobileError("services.errors.invalidTransition", 409);
    }
    if (isServiceSnapshotJobLocked(error)) {
      return mobileError("services.errors.signedSnapshotLocked", 409);
    }
    if (message.startsWith("SERVICE_COMPLETION_INVALID:")) {
      return mobileError(message.slice("SERVICE_COMPLETION_INVALID:".length), 409);
    }
    if (message === "SERVICE_MUTATION_RETRY") {
      return mobileError("services.errors.mutationRetry", 409);
    }
    if (message === "SERVICE_MUTATION_ID_CONFLICT") {
      return mobileError("services.errors.invalidTransition", 409);
    }
    if (message === "SERVICE_MUTATION_PAYLOAD_CONFLICT") {
      return mobileError("services.errors.invalidTransition", 409);
    }
    console.error("field service operation failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
