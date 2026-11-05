import { getAuthenticatedUser } from "@/lib/auth/store-context";
import { mobileError } from "@/lib/mobile/response";

// Block acceptance of existing staff invitations; retain records for audit.
export async function POST() {
  const user = await getAuthenticatedUser();
  if (!user) return mobileError("errors.unauthorized", 401);
  return mobileError("errors.notFound", 404);
}
