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

export async function uploadAiAttachment(file: File, surface = "web"): Promise<ComposerAttachment> {
  const form = new FormData();
  form.append("file", file);
  form.append("surface", surface);
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
