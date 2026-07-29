import { mobileError, mobileOk } from "@/lib/mobile/response";

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
    if (message === "SERVICE_COMPLETION_STATUS_INVALID") {
      return mobileError("services.errors.invalidTransition", 409);
    }
    if (message.startsWith("SERVICE_COMPLETION_INVALID:")) {
      return mobileError(message.slice("SERVICE_COMPLETION_INVALID:".length), 409);
    }
    if (message === "SERVICE_MUTATION_RETRY") {
      return mobileError("services.errors.mutationRetry", 409);
    }
    console.error("field service operation failed:", error);
    return mobileError("errors.serverError", 500);
  }
}
