import { NextResponse } from "next/server";
import { readSelfHostedReadiness } from "@/lib/ops/self-hosted-readiness";

export const runtime = "nodejs";

export async function GET() {
  try {
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
