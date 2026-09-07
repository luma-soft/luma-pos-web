import { getNotificationActivityPage } from "@/lib/audit/notification-activities";
import { requireStoreContext } from "@/lib/auth/store-context";
import { NotificationsClient } from "./notifications-client";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const { storeId, userId } = await requireStoreContext();
  const activities = await getNotificationActivityPage(storeId, userId, 1, 15);

  return <NotificationsClient activities={activities} />;
}
