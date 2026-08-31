import type { ComposerAttachment } from "./types";

export async function postJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json?.data ?? json;
}

export async function putJson(path: string, body: unknown) {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json?.data ?? json;
}

export async function deleteJson(path: string) {
  const res = await fetch(path, { method: "DELETE" });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json?.data ?? json;
}

export async function getJson(path: string) {
  const res = await fetch(path);
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json?.data ?? json;
}

export async function uploadAiAttachment(
  file: File,
  surface: string,
  sessionId: string,
): Promise<ComposerAttachment> {
  const form = new FormData();
  form.append("file", file);
  form.append("surface", surface);
  form.append("sessionId", sessionId);
  const res = await fetch("/api/mobile/ai/attachments", {
    method: "POST",
    body: form,
  });
  const json = await res.json().catch(() => null);
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error ?? `http.${res.status}`);
  }
  return json.data as ComposerAttachment;
}

export async function resolveAiAttachmentUrl(
  attachment: ComposerAttachment,
): Promise<string | null> {
  if (attachment.previewUrl) return attachment.previewUrl;
  const params = attachment.mediaId
    ? new URLSearchParams({ mediaId: attachment.mediaId })
    : attachment.bucket && attachment.path
      ? new URLSearchParams({
        bucket: attachment.bucket,
        path: attachment.path,
      })
      : null;
  if (params) {
    const res = await fetch(`/api/mobile/ai/attachments?${params.toString()}`);
    const json = await res.json().catch(() => null);
    if (
      res.ok
      && json?.ok !== false
      && typeof json?.data?.signedUrl === "string"
    ) return json.data.signedUrl as string;
  }
  return attachment.signedUrl ?? null;
}
