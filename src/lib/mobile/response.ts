import { NextResponse } from "next/server";
import type { ActionResult } from "@/lib/actions/common";

export function mobileOk<T>(data: T) {
  return NextResponse.json({ ok: true, data });
}

export function mobileAccepted<T>(data: T) {
  return NextResponse.json({ ok: true, data }, { status: 202 });
}

export function mobileError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export function mobileConflict(
  error: string,
  conflict: Record<string, unknown>,
) {
  return NextResponse.json({ ok: false, error, conflict }, { status: 409 });
}

export function mobileGate(gate: { ok: true } | { ok: false; error: string }) {
  if (gate.ok) return null;
  return mobileError(
    gate.error,
    gate.error === "errors.unauthorized" ? 401 : 403
  );
}

export function mobileAction<T>(result: ActionResult<T>) {
  if (result.ok) return mobileOk(result.data);
  return mobileError(result.error);
}

export async function readJson(request: Request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

export function searchParam(
  request: Request,
  key: string,
  fallback?: string
): string | undefined {
  const value = new URL(request.url).searchParams.get(key)?.trim();
  return value || fallback;
}

export function numberParam(request: Request, key: string, fallback: number) {
  const value = Number(new URL(request.url).searchParams.get(key));
  return Number.isFinite(value) ? value : fallback;
}
