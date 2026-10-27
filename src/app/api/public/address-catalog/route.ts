import { NextResponse } from "next/server";
import { getVietnamWards, vietnamProvinces } from "@/lib/addresses/vietnam";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const provinceCode = new URL(request.url).searchParams.get("provinceCode")?.trim();
  const options = provinceCode ? getVietnamWards(provinceCode) : vietnamProvinces;
  const response = NextResponse.json({ ok: true, data: { options } });
  response.headers.set("Cache-Control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000");
  return response;
}
