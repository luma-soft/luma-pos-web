import { NextResponse } from "next/server";
import { getStoreSettings } from "@/lib/data/settings";

export const dynamic = "force-dynamic";

/** Store name is intentionally public because it is shown on the login screen. */
export async function GET() {
  const store = await getStoreSettings();
  return NextResponse.json({ name: store.name });
}
