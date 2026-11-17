import { AdminClient } from "@/components/admin/admin-client";
import { OWNER_ROLES } from "@/lib/auth/roles";
import { requireStoreRole } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireStoreRole(OWNER_ROLES);
  return <AdminClient />;
}
