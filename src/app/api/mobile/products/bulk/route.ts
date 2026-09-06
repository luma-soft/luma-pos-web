import { z } from "zod";
import { bulkDeleteProducts, bulkStopSellingProducts } from "@/lib/actions/products";
import { requireMobileStockAccess } from "@/lib/mobile/auth";
import { mobileAction, mobileError, mobileGate, readJson } from "@/lib/mobile/response";
const schema = z.object({ action: z.enum(["stop", "delete"]), ids: z.array(z.uuid()).min(1).max(100) });
export async function POST(request: Request) {
  const gate = await requireMobileStockAccess();
  if (!gate.ok) return mobileGate(gate);
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return mobileError("errors.invalidData");
  const { action, ids } = parsed.data;
  if (action === "delete") return mobileAction(await bulkDeleteProducts(ids));
  return mobileAction(await bulkStopSellingProducts(ids));
}
