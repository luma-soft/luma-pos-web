import { AdminClient } from "@/components/admin/admin-client";
import { MANAGER_ROLES } from "@/lib/auth/roles";
import { requireStoreRole } from "@/lib/auth/store-context";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const context = await requireStoreRole(MANAGER_ROLES);
  return <AdminClient canManageOperations={context.role === "owner"} />;
}
