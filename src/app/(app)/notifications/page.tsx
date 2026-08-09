import { getAuditLogs } from "@/lib/audit";
import { requireUser } from "@/lib/actions/common";
import { NotificationsClient } from "./notifications-client";

export const dynamic = "force-dynamic";

export default async function NotificationsPage() {
  const user = await requireUser();
  const activities = await getAuditLogs({
    notificationUserId: user.id,
    limit: 100,
  });

  return <NotificationsClient activities={activities} />;
}
