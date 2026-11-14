import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET() {
  if (
    process.env.LUMAPOS_AUTH_PROVIDER?.trim().toLowerCase() === "lumapos"
    && process.env.LUMAPOS_PRIMARY_DATABASE_CONFIRMED !== "true"
  ) {
    return NextResponse.json({
      status: "not_ready",
      primaryDatabase: { status: "not_ready", confirmed: false },
      missingPrimary: ["notConfirmed"],
    }, {
      status: 503,
      headers: { "Cache-Control": "no-store" },
    });
  }

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
