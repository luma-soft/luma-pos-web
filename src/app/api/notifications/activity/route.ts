import { NextResponse } from "next/server";
import { getNotificationActivityPage } from "@/lib/audit/notification-activities";
import { requireStoreContext } from "@/lib/auth/store-context";
import { coercePageSize } from "@/lib/pagination";

export async function GET(request: Request) {
  const { storeId, userId } = await requireStoreContext();
  const params = new URL(request.url).searchParams;
  const page = Math.max(1, Number(params.get("page")) || 1);
  const pageSize = coercePageSize(Number(params.get("size")), 15);
  const data = await getNotificationActivityPage(storeId, userId, page, pageSize);
  return NextResponse.json({ ok: true, data });
}
