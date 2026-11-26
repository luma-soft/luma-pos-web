import { readSource } from "../../../test-support/read-source.mjs";
import assert from "node:assert/strict";
import test from "node:test";

const client = readSource("./settings-client.tsx", import.meta.url);
const actions = readSource("../../../lib/actions/settings.ts", import.meta.url);

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
    const source = readSource(path, import.meta.url);
    assert.match(source, /mobileError\("errors\.notFound", 404\)/);
    assert.doesNotMatch(source, /applyStaffSettingsMutation|createStaffInvitation|createCashierContextToken|acceptStaffInvitation/);
  });
}
