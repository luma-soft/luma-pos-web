import { NextResponse } from "next/server";
import { getStoreSettings } from "@/lib/data/settings";
import { CURRENT_STORE_ID } from "@/lib/tenancy/constants";

export const dynamic = "force-dynamic";

/** Store name is intentionally public because it is shown on the login screen. */
export async function GET() {
  const store = await getStoreSettings(CURRENT_STORE_ID);
  return NextResponse.json({ name: store.name });
}
