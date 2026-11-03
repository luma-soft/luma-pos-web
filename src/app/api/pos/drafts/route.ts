import { NextResponse } from "next/server";
import { UnauthorizedError, requireStoreContext } from "@/lib/auth/store-context";
import {
  getSharedPosDrafts,
  sharedPosDraftSyncSchema,
  syncSharedPosDrafts,
} from "@/lib/pos/shared-drafts";

export async function GET() {
  try {
    const context = await requireStoreContext();
    const drafts = await getSharedPosDrafts(context.storeId, context.userId);
    return NextResponse.json({ drafts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "errors.unauthorized" }, { status: 401 });
    }
    throw error;
  }
}

export async function POST(request: Request) {
  try {
    const context = await requireStoreContext();
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400 });
    }
    const parsed = sharedPosDraftSyncSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "errors.invalidData" }, { status: 400 });
    }
    const drafts = await syncSharedPosDrafts(
      context.storeId,
      context.userId,
      context.userId,
      parsed.data,
    );
    return NextResponse.json({ drafts }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "errors.unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
