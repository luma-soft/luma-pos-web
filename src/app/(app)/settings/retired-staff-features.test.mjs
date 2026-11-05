import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("./settings-client.tsx", import.meta.url), "utf8");
const actions = readFileSync(new URL("../../../lib/actions/settings.ts", import.meta.url), "utf8");

test("staff and role-administration screens and their actions are retired", () => {
  assert.doesNotMatch(client, /StaffSection|StaffRowItem|active === "staff"|id: "staff"/);
  assert.doesNotMatch(actions, /export async function (loadSettingsStaff|updateStaffRole|setStaffActive)/);
  assert.doesNotMatch(client, /configurableRolesForNotificationCategory|setRoutingRole/);
});

test("checkout-adjacent settings and notifications stay accessible", () => {
  assert.match(client, /function PosSettingsSection/);
  assert.match(client, /function PaymentsSection/);
  assert.match(client, /function NotificationsSection/);
  assert.match(client, /availableChannels\.map/);
  assert.match(client, /function HardwareSection/);
});

for (const path of [
  "../../../app/api/mobile/auth/cashier-switch/route.ts",
  "../../../app/api/mobile/settings/staff/route.ts",
  "../../../app/api/mobile/settings/staff/invitations/route.ts",
  "../../../app/api/mobile/settings/staff/[id]/pin/route.ts",
  "../../../app/api/mobile/auth/invitations/accept/route.ts",
]) {
  test("retired mutation API rejects calls: " + path, () => {
    const source = readFileSync(new URL(path, import.meta.url), "utf8");
    assert.match(source, /mobileError\("errors\.notFound", 404\)/);
    assert.doesNotMatch(source, /applyStaffSettingsMutation|createStaffInvitation|createCashierContextToken|acceptStaffInvitation/);
  });
}
