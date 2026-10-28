import { NextResponse } from "next/server";
import { UnauthorizedError, requireStoreContext } from "@/lib/auth/store-context";
import { getActiveTickets } from "@/lib/data/kitchen";

export async function GET() {
  try {
    const context = await requireStoreContext();
    const tickets = await getActiveTickets(context.storeId);
    return NextResponse.json({
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        tableName: ticket.tableName,
        round: ticket.round,
        createdAtMs: ticket.createdAt.getTime(),
        items: ticket.items,
      })),
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false, error: "errors.unauthorized" }, { status: 401 });
    }
    throw error;
  }
}
