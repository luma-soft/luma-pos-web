import { sql } from "drizzle-orm";
import { NextResponse } from "next/server";
import { db } from "@/db";

export const runtime = "nodejs";

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return NextResponse.json({ status: "ready" });
  } catch {
    return NextResponse.json({ status: "not_ready" }, { status: 503 });
  }
}
