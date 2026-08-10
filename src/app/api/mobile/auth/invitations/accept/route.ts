import { getAuthenticatedUser } from "@/lib/auth/store-context";
import { acceptStaffInvitation } from "@/lib/auth/staff-invitations";
import { mobileAction, mobileError, readJson } from "@/lib/mobile/response";

export async function POST(request: Request) {
  const user = await getAuthenticatedUser();
  if (!user) return mobileError("errors.unauthorized", 401);
  const body = await readJson(request);
  const payload = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const token = typeof payload.token === "string" ? payload.token : "";
  const fullName = typeof payload.fullName === "string" ? payload.fullName : "";
  return mobileAction(await acceptStaffInvitation({
    token,
    userId: user.id,
    email: user.email ?? null,
    phone: user.phone ?? null,
    fullName,
  }));
}
