import { createHmac, timingSafeEqual } from "node:crypto";

export type EInvoiceProviderRequest = {
  requestId: string;
  orderId: string;
  buyerName: string;
  buyerTaxCode?: string | null;
  buyerAddress?: string | null;
  buyerEmail?: string | null;
  vatRate: number;
  totalBeforeVat: number;
  vatAmount: number;
  total: number;
  seller: {
    name: string;
    taxCode: string;
    address: string;
  };
  lines: Array<{
    name: string;
    unit: string;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    vatRate: number;
  }>;
};

export type EInvoiceProviderResult =
  | {
      outcome: "issued";
      number: string;
      serial: string;
      providerReference?: string | null;
      issuedAt: Date;
    }
  | {
      outcome: "retryable_error" | "permanent_error";
      error: string;
    };

export type EInvoiceProviderAdapter = {
  id: string;
  issue(request: EInvoiceProviderRequest): Promise<EInvoiceProviderResult>;
};

export function selectEInvoiceIssuanceProvider(input: {
  einvoiceEnabled?: boolean;
  einvoiceProvider?: string | null;
}):
  | { ok: true; provider: string }
  | { ok: false; error: "einvoice.errors.disabled" | "einvoice.errors.providerNotConfigured" } {
  if (!input.einvoiceEnabled) {
    return { ok: false, error: "einvoice.errors.disabled" };
  }
  const provider = input.einvoiceProvider?.trim() ?? "";
  if (!provider) {
    return { ok: false, error: "einvoice.errors.providerNotConfigured" };
  }
  return { ok: true, provider };
}

export function resetEInvoiceRetryBudgetForManualSubmission(previous: {
  status: string;
  attemptCount: number;
}) {
  if (previous.status === "issued" || previous.status === "processing") {
    throw new Error("einvoice.errors.notRetryable");
  }
  return {
    attemptCount: 0,
    lastAttemptAt: null,
    lastError: null,
  } as const;
}

export type SignedEInvoiceBridgeConfig = {
  provider: string;
  endpoint: string;
  apiKey: string;
  hmacSecret: string;
  timeoutMs?: number;
};

type SignedEInvoiceBridgeDependencies = {
  fetch?: typeof fetch;
  now?: () => Date;
};

function bridgeSignature(secret: string, timestamp: string, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`, "utf8")
    .digest("hex");
}

function equalHex(left: string, right: string) {
  if (!/^[a-f0-9]{64}$/i.test(left) || !/^[a-f0-9]{64}$/i.test(right)) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

/**
 * Production server-to-server adapter contract for a merchant-owned e-invoice
 * bridge. The bridge may talk to VNPT, Viettel, MISA, or another selected
 * vendor; LumaPOS accepts an issued invoice only from a fresh signed response.
 */
export function createSignedEInvoiceBridgeAdapter(
  config: SignedEInvoiceBridgeConfig,
  dependencies: SignedEInvoiceBridgeDependencies = {},
): EInvoiceProviderAdapter {
  const fetchImpl = dependencies.fetch ?? fetch;
  const now = dependencies.now ?? (() => new Date());
  return {
    id: `signed-bridge:${config.provider}`,
    async issue(request) {
      const timestamp = String(now().getTime());
      const body = JSON.stringify({
        version: "1",
        provider: config.provider,
        invoice: request,
      });
      let response: Response;
      let responseBody: string;
      const controller = new AbortController();
      const timeoutMs = Math.max(
        1,
        Math.min(60_000, Math.trunc(config.timeoutMs ?? 15_000)),
      );
      const timeout = setTimeout(() => controller.abort(), timeoutMs);
      try {
        response = await fetchImpl(config.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            "content-type": "application/json",
            "x-luma-request-id": request.requestId,
            "x-luma-timestamp": timestamp,
            "x-luma-signature": bridgeSignature(
              config.hmacSecret,
              timestamp,
              body,
            ),
          },
          body,
          signal: controller.signal,
        });
        responseBody = await response.text();
      } catch {
        return {
          outcome: "retryable_error",
          error: controller.signal.aborted
            ? "einvoice.errors.providerTimeout"
            : "einvoice.errors.providerUnavailable",
        };
      } finally {
        clearTimeout(timeout);
      }

      const responseTimestamp = response.headers.get("x-luma-timestamp") ?? "";
      const receivedSignature = response.headers.get("x-luma-signature") ?? "";
      const responseTime = Number(responseTimestamp);
      const signatureValid = equalHex(
        receivedSignature,
        bridgeSignature(config.hmacSecret, responseTimestamp, responseBody),
      );
      if (
        !response.ok ||
        !Number.isFinite(responseTime) ||
        Math.abs(now().getTime() - responseTime) > 5 * 60_000 ||
        !signatureValid
      ) {
        return {
          outcome: "retryable_error",
          error: "einvoice.errors.invalidProviderResponse",
        };
      }

      try {
        const payload = JSON.parse(responseBody) as Record<string, unknown>;
        if (payload.status === "pending") {
          return {
            outcome: "retryable_error",
            error: "einvoice.errors.providerPending",
          };
        }
        if (payload.status === "rejected") {
          return {
            outcome: "permanent_error",
            error: "einvoice.errors.providerRejected",
          };
        }
        const issuedAt = new Date(String(payload.issuedAt ?? ""));
        if (
          payload.status === "issued" &&
          typeof payload.number === "string" &&
          payload.number.trim() &&
          typeof payload.serial === "string" &&
          payload.serial.trim() &&
          Number.isFinite(issuedAt.getTime())
        ) {
          return {
            outcome: "issued",
            number: payload.number.trim(),
            serial: payload.serial.trim(),
            providerReference:
              typeof payload.providerReference === "string"
                ? payload.providerReference.trim() || null
                : null,
            issuedAt,
          };
        }
      } catch {
        // The fixed error key below does not leak provider payloads or PII.
      }
      return {
        outcome: "retryable_error",
        error: "einvoice.errors.invalidProviderResponse",
      };
    },
  };
}

export type EInvoiceAttemptResult = {
  status: "issued" | "queued" | "error";
  attemptCount: number;
  number: string | null;
  serial: string | null;
  providerReference: string | null;
  issuedAt: Date | null;
  error: string | null;
  nextAttemptAt: Date | null;
};

const retryMinutes = [1, 5, 15, 60, 180, 360, 720] as const;

export function nextEInvoiceRetryAt(
  attemptCount: number,
  now = new Date(),
): Date | null {
  const delayMinutes = retryMinutes[attemptCount - 1];
  if (delayMinutes == null) return null;
  return new Date(now.getTime() + delayMinutes * 60_000);
}

export async function executeEInvoiceAttempt(input: {
  adapter: EInvoiceProviderAdapter | null;
  request: EInvoiceProviderRequest;
  attemptCount: number;
  now?: Date;
}): Promise<EInvoiceAttemptResult> {
  const now = input.now ?? new Date();
  const attemptCount = input.attemptCount + 1;
  if (!input.adapter) {
    return {
      status: "error",
      attemptCount,
      number: null,
      serial: null,
      providerReference: null,
      issuedAt: null,
      error: "einvoice.errors.providerNotConfigured",
      nextAttemptAt: null,
    };
  }

  let providerResult: EInvoiceProviderResult;
  try {
    providerResult = await input.adapter.issue(input.request);
  } catch {
    providerResult = {
      outcome: "retryable_error",
      error: "einvoice.errors.providerUnavailable",
    };
  }

  if (providerResult.outcome === "issued") {
    const number = providerResult.number.trim();
    const serial = providerResult.serial.trim();
    if (number && serial && Number.isFinite(providerResult.issuedAt.getTime())) {
      return {
        status: "issued",
        attemptCount,
        number,
        serial,
        providerReference: providerResult.providerReference?.trim() || null,
        issuedAt: providerResult.issuedAt,
        error: null,
        nextAttemptAt: null,
      };
    }
    providerResult = {
      outcome: "permanent_error",
      error: "einvoice.errors.invalidProviderResponse",
    };
  }

  const nextAttemptAt = providerResult.outcome === "retryable_error"
    ? nextEInvoiceRetryAt(attemptCount, now)
    : null;
  return {
    status: nextAttemptAt ? "queued" : "error",
    attemptCount,
    number: null,
    serial: null,
    providerReference: null,
    issuedAt: null,
    error: providerResult.error,
    nextAttemptAt,
  };
}

export function resolveEInvoiceProviderAdapter(
  provider: string | null | undefined,
  environment: Record<string, string | undefined> = process.env,
): EInvoiceProviderAdapter | null {
  const selectedProvider = provider?.trim() ?? "";
  const configuredProvider = environment.EINVOICE_BRIDGE_PROVIDER?.trim() ?? "";
  const endpoint = environment.EINVOICE_BRIDGE_URL?.trim() ?? "";
  const apiKey = environment.EINVOICE_BRIDGE_API_KEY?.trim() ?? "";
  const hmacSecret = environment.EINVOICE_BRIDGE_HMAC_SECRET ?? "";
  if (
    !selectedProvider ||
    selectedProvider.toLocaleLowerCase("en") !==
      configuredProvider.toLocaleLowerCase("en") ||
    !apiKey ||
    hmacSecret.length < 32
  ) {
    return null;
  }

  try {
    const url = new URL(endpoint);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return null;
    }
  } catch {
    return null;
  }

  return createSignedEInvoiceBridgeAdapter({
    provider: configuredProvider,
    endpoint,
    apiKey,
    hmacSecret,
  });
}

export type EInvoiceProviderReadiness = {
  enabled: boolean;
  provider: string | null;
  configured: boolean;
  available: boolean;
  reason: "disabled" | "providerNotConfigured" | null;
};

export function getEInvoiceProviderReadiness(
  input: {
    einvoiceEnabled?: boolean;
    einvoiceProvider?: string | null;
  },
  environment: Record<string, string | undefined> = process.env,
): EInvoiceProviderReadiness {
  const provider = input.einvoiceProvider?.trim() || null;
  const adapter = provider
    ? resolveEInvoiceProviderAdapter(provider, environment)
    : null;
  const configured = adapter != null;
  const selection = selectEInvoiceIssuanceProvider(input);
  if (!selection.ok) {
    return {
      enabled: Boolean(input.einvoiceEnabled),
      provider,
      configured,
      available: false,
      reason: selection.error === "einvoice.errors.disabled"
        ? "disabled"
        : "providerNotConfigured",
    };
  }
  return {
    enabled: true,
    provider: selection.provider,
    configured,
    available: configured,
    reason: adapter ? null : "providerNotConfigured",
  };
}
