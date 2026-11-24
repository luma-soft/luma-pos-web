import { z } from "zod";

/** Allowed clock skew between a client device and the server. */
const FUTURE_SKEW_MS = 5 * 60_000;

/**
 * Optional user-chosen document time (backdating). Empty values mean "now".
 * Future times are rejected. It dates the document and its cash entries only;
 * stock movements keep their real posting time for cost valuation.
 */
export const documentTimeSchema = z.preprocess(
  (value) => value === "" || value === null ? undefined : value,
  z.coerce.date()
    .refine((date) => date.getTime() <= Date.now() + FUTURE_SKEW_MS, { error: "errors.documentTimeFuture" })
    .optional(),
);

/** Map a failed parse to the future-time message when that was the cause. */
export function invalidInputError(error: z.ZodError): string {
  return error.issues.some((issue) => issue.message === "errors.documentTimeFuture")
    ? "errors.documentTimeFuture"
    : "errors.invalidData";
}
