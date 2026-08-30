import {
  MEDIA_PURPOSES,
  mediaIdSchema,
  normalizeMediaType,
  type MediaPurpose,
} from "./schemas";

const MEDIA_UPLOADS_ENDPOINT = "/api/mobile/media/uploads";

export type ManagedMediaUploadRequest = {
  purpose: MediaPurpose;
  targetId: string;
  signal?: AbortSignal;
};

export type ManagedMediaDescriptor = {
  id: string;
  visibility: "public" | "private";
  mimeType: string;
  sizeBytes: number;
  fileName: string;
  url: string;
  thumbnailUrl: string | null;
};

export type ManagedMediaUploadStage = "intent" | "upload" | "complete";
export type ManagedMediaRetryFrom = "intent" | "complete";

export class ManagedMediaUploadError extends Error {
  readonly stage: ManagedMediaUploadStage;
  readonly code: string;
  readonly statusCode: number | undefined;
  readonly mediaId: string | undefined;
  readonly retryFrom: ManagedMediaRetryFrom;
  readonly cancelled: boolean;

  constructor(input: {
    stage: ManagedMediaUploadStage;
    code: string;
    statusCode?: number;
    mediaId?: string;
    retryFrom: ManagedMediaRetryFrom;
    cancelled?: boolean;
  }) {
    super(input.code);
    this.name = "ManagedMediaUploadError";
    this.stage = input.stage;
    this.code = input.code;
    this.statusCode = input.statusCode;
    this.mediaId = input.mediaId;
    this.retryFrom = input.retryFrom;
    this.cancelled = input.cancelled ?? false;
  }
}

type UploadIntent = {
  media: {
    id: string;
    visibility: "public" | "private";
    status: "pending";
    mimeType: string;
    sizeBytes: number;
    fileName: string;
  };
  method: "PUT";
  uploadUrl: string;
  headers: {
    "Content-Type": string;
    "If-None-Match": "*";
  };
  expiresAt: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isVisibility(value: unknown): value is "public" | "private" {
  return value === "public" || value === "private";
}

function isFutureTask3IsoDate(value: unknown, now: Date): value is string {
  if (typeof value !== "string") return false;
  const expiresAt = Date.parse(value);
  const nowMs = now.getTime();
  return Number.isFinite(expiresAt)
    && Number.isFinite(nowMs)
    && new Date(expiresAt).toISOString() === value
    && expiresAt > nowMs;
}

function isAbsoluteHttpUrl(value: unknown): value is string {
  if (!isNonEmptyString(value)) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:")
      && !url.username
      && !url.password
      && Boolean(url.host);
  } catch {
    return false;
  }
}

function pendingMediaId(value: unknown): string | undefined {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) {
    return undefined;
  }
  const media = value.data.media;
  if (
    !isRecord(media)
    || media.status !== "pending"
    || !mediaIdSchema.safeParse(media.id).success
  ) {
    return undefined;
  }
  return media.id as string;
}

function parseUploadIntent(
  value: unknown,
  file: File,
  request: ManagedMediaUploadRequest,
  now: Date,
): UploadIntent | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) return null;
  const data = value.data;
  if (!isRecord(data.media) || !isRecord(data.headers)) return null;
  const media = data.media;
  const headers = data.headers;
  const expectedMimeType = normalizeMediaType(file.type);
  const expectedVisibility = MEDIA_PURPOSES[request.purpose].visibility;
  const headerNames = Object.keys(headers).sort();
  if (
    headerNames.length !== 2
    || headerNames[0] !== "Content-Type"
    || headerNames[1] !== "If-None-Match"
  ) {
    return null;
  }
  if (
    !mediaIdSchema.safeParse(media.id).success
    || !isVisibility(media.visibility)
    || media.visibility !== expectedVisibility
    || media.status !== "pending"
    || !isNonEmptyString(media.mimeType)
    || media.mimeType !== expectedMimeType
    || !Number.isSafeInteger(media.sizeBytes)
    || (media.sizeBytes as number) <= 0
    || !isNonEmptyString(media.fileName)
    || media.sizeBytes !== file.size
    || media.fileName !== file.name
    || data.method !== "PUT"
    || !isAbsoluteHttpUrl(data.uploadUrl)
    || headers["Content-Type"] !== media.mimeType
    || headers["If-None-Match"] !== "*"
    || !isFutureTask3IsoDate(data.expiresAt, now)
  ) {
    return null;
  }
  return data as UploadIntent;
}

function parseDescriptor(
  value: unknown,
  intent: UploadIntent,
): ManagedMediaDescriptor | null {
  if (!isRecord(value) || value.ok !== true || !isRecord(value.data)) return null;
  const data = value.data;
  if (
    data.id !== intent.media.id
    || !isVisibility(data.visibility)
    || data.visibility !== intent.media.visibility
    || data.mimeType !== intent.media.mimeType
    || data.sizeBytes !== intent.media.sizeBytes
    || data.fileName !== intent.media.fileName
    || !isAbsoluteHttpUrl(data.url)
    || (
      data.thumbnailUrl !== null
      && !isAbsoluteHttpUrl(data.thumbnailUrl)
    )
  ) {
    return null;
  }
  return {
    id: data.id,
    visibility: data.visibility,
    mimeType: data.mimeType,
    sizeBytes: data.sizeBytes,
    fileName: data.fileName,
    url: data.url,
    thumbnailUrl: data.thumbnailUrl,
  };
}

function retryFrom(stage: ManagedMediaUploadStage): ManagedMediaRetryFrom {
  return stage === "complete" ? "complete" : "intent";
}

function uploadError(input: {
  stage: ManagedMediaUploadStage;
  code: string;
  statusCode?: number;
  mediaId?: string;
  cancelled?: boolean;
}): ManagedMediaUploadError {
  return new ManagedMediaUploadError({
    ...input,
    retryFrom: retryFrom(input.stage),
  });
}

function isAbortFailure(error: unknown, signal?: AbortSignal): boolean {
  return signal?.aborted === true
    || (isRecord(error) && error.name === "AbortError");
}

function throwIfCancelled(
  stage: ManagedMediaUploadStage,
  signal?: AbortSignal,
  mediaId?: string,
) {
  if (!signal?.aborted) return;
  throw uploadError({
    stage,
    code: "media.uploadCancelled",
    mediaId,
    cancelled: true,
  });
}

async function fetchStage(
  fetcher: typeof fetch,
  input: string,
  init: RequestInit,
  stage: ManagedMediaUploadStage,
  signal?: AbortSignal,
  mediaId?: string,
): Promise<Response> {
  throwIfCancelled(stage, signal, mediaId);
  try {
    const response = await fetcher(input, init);
    throwIfCancelled(stage, signal, mediaId);
    return response;
  } catch (error) {
    if (error instanceof ManagedMediaUploadError) throw error;
    if (isAbortFailure(error, signal)) {
      throw uploadError({
        stage,
        code: "media.uploadCancelled",
        mediaId,
        cancelled: true,
      });
    }
    throw uploadError({
      stage,
      code: stage === "intent"
        ? "media.intentNetworkFailed"
        : stage === "upload"
          ? "media.uploadNetworkFailed"
          : "media.completionNetworkFailed",
      mediaId,
    });
  }
}

async function readJson(
  response: Response,
  stage: "intent" | "complete",
  signal?: AbortSignal,
  mediaId?: string,
): Promise<unknown> {
  throwIfCancelled(stage, signal, mediaId);
  try {
    const value: unknown = await response.json();
    throwIfCancelled(stage, signal, mediaId);
    return value;
  } catch (error) {
    if (error instanceof ManagedMediaUploadError) throw error;
    if (isAbortFailure(error, signal)) {
      throw uploadError({
        stage,
        code: "media.uploadCancelled",
        mediaId,
        cancelled: true,
      });
    }
    throw uploadError({
      stage,
      code: stage === "intent"
        ? "media.invalidIntentResponse"
        : "media.invalidCompletionResponse",
      statusCode: response.status,
      mediaId,
    });
  }
}

async function discardResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // Provider response bodies are intentionally neither retained nor surfaced.
  }
}

export async function uploadManagedMedia(
  file: File,
  request: ManagedMediaUploadRequest,
  fetcher: typeof fetch = globalThis.fetch,
  now: () => Date = () => new Date(),
): Promise<ManagedMediaDescriptor> {
  const signal = request.signal;
  const intentResponse = await fetchStage(
    fetcher,
    MEDIA_UPLOADS_ENDPOINT,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        purpose: request.purpose,
        targetId: request.targetId,
        fileName: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      }),
      signal,
    },
    "intent",
    signal,
  );
  if (!intentResponse.ok) {
    await discardResponseBody(intentResponse);
    throw uploadError({
      stage: "intent",
      code: "media.intentFailed",
      statusCode: intentResponse.status,
    });
  }
  const intentPayload = await readJson(intentResponse, "intent", signal);
  const mediaId = pendingMediaId(intentPayload);
  const intent = parseUploadIntent(
    intentPayload,
    file,
    request,
    now(),
  );
  if (!intent) {
    throw uploadError({
      stage: "intent",
      code: "media.invalidIntentResponse",
      statusCode: intentResponse.status,
      mediaId,
    });
  }

  const validatedMediaId = intent.media.id;
  const uploadResponse = await fetchStage(
    fetcher,
    intent.uploadUrl,
    {
      method: "PUT",
      credentials: "omit",
      redirect: "error",
      referrerPolicy: "no-referrer",
      headers: {
        "Content-Type": intent.headers["Content-Type"],
        "If-None-Match": intent.headers["If-None-Match"],
      },
      body: file,
      signal,
    },
    "upload",
    signal,
    validatedMediaId,
  );
  if (!uploadResponse.ok) {
    await discardResponseBody(uploadResponse);
    throw uploadError({
      stage: "upload",
      code: "media.uploadFailed",
      statusCode: uploadResponse.status,
      mediaId: validatedMediaId,
    });
  }
  await discardResponseBody(uploadResponse);

  const completionResponse = await fetchStage(
    fetcher,
    `${MEDIA_UPLOADS_ENDPOINT}/${encodeURIComponent(validatedMediaId)}/complete`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}",
      signal,
    },
    "complete",
    signal,
    validatedMediaId,
  );
  if (!completionResponse.ok) {
    await discardResponseBody(completionResponse);
    throw uploadError({
      stage: "complete",
      code: "media.completionFailed",
      statusCode: completionResponse.status,
      mediaId: validatedMediaId,
    });
  }
  const descriptor = parseDescriptor(
    await readJson(
      completionResponse,
      "complete",
      signal,
      validatedMediaId,
    ),
    intent,
  );
  if (!descriptor) {
    throw uploadError({
      stage: "complete",
      code: "media.invalidCompletionResponse",
      statusCode: completionResponse.status,
      mediaId: validatedMediaId,
    });
  }
  return descriptor;
}
