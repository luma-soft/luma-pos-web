import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  try {
    const { readSelfHostedReadiness } = await import("@/lib/ops/self-hosted-readiness");
    const readiness = await readSelfHostedReadiness();
    return NextResponse.json(readiness, {
      status: readiness.status === "ready" ? 200 : 503,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ status: "not_ready" }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }
}
