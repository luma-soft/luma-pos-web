import { strict as assert } from "node:assert";
import { afterAll, mock } from "bun:test";

afterAll(() => mock.restore());

let gate = {
  ok: true,
  userId: "91000000-0000-4000-8000-000000000002",
  storeId: "00000000-0000-4000-8000-000000000001",
  role: "cashier",
  principalId: "91000000-0000-4000-8000-000000000001",
};
let registerResult = { kind: "registered" };
let deactivateResult = { kind: "deactivated" };
let registerInput;
let deactivateInput;

mock.module("@/app/api/mobile/notifications/devices/dependencies", () => ({
  db: {},
  async requireMobileUser() {
    return gate;
  },
  async registerPushDeviceBinding(_database, input) {
    registerInput = input;
    return registerResult;
  },
  async deactivatePushDeviceBinding(_database, input) {
    deactivateInput = input;
    return deactivateResult;
  },
}));

const route = await import(
  "../src/app/api/mobile/notifications/devices/route.ts"
);

const validDevice = {
  deviceId: "shared-terminal-route-contract",
  platform: "ios",
  token: "route-contract-token-value-long-enough",
  permission: "authorized",
  locale: "vi",
  bindingGeneration: 42,
};

function request(method, body) {
  return new Request("https://luma.test/api/mobile/notifications/devices", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function json(response) {
  return response.json();
}

let passed = 0;
let failed = 0;
async function check(name, run) {
  try {
    await run();
    passed += 1;
    console.log(`  ✅ ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`  ❌ ${name}`);
    console.error(error);
  }
}

await check("auth failures retain their HTTP contract and do not mutate a binding", async () => {
  gate = { ok: false, error: "errors.unauthorized" };
  registerInput = undefined;
  deactivateInput = undefined;

  const postResponse = await route.POST(request("POST", validDevice));
  const deleteResponse = await route.DELETE(request("DELETE", {
    deviceId: validDevice.deviceId,
    bindingGeneration: 43,
  }));

  assert.equal(postResponse.status, 401);
  assert.deepEqual(await json(postResponse), {
    ok: false,
    error: "errors.unauthorized",
  });
  assert.equal(deleteResponse.status, 401);
  assert.equal(registerInput, undefined);
  assert.equal(deactivateInput, undefined);
});

await check("POST and DELETE map an active send lease to retryable 409", async () => {
  gate = {
    ok: true,
    userId: "91000000-0000-4000-8000-000000000002",
    storeId: "00000000-0000-4000-8000-000000000001",
    role: "cashier",
    principalId: "91000000-0000-4000-8000-000000000001",
  };
  registerResult = { kind: "busy", retryAfterMs: 12_000 };
  deactivateResult = { kind: "busy", retryAfterMs: 12_000 };

  const postResponse = await route.POST(request("POST", validDevice));
  const deleteResponse = await route.DELETE(request("DELETE", {
    deviceId: validDevice.deviceId,
    bindingGeneration: 43,
  }));

  assert.equal(postResponse.status, 409);
  assert.deepEqual(await json(postResponse), {
    ok: false,
    error: "errors.deviceBindingBusy",
  });
  assert.equal(deleteResponse.status, 409);
  assert.deepEqual(await json(deleteResponse), {
    ok: false,
    error: "errors.deviceBindingBusy",
  });
});

await check("POST and DELETE map a stale generation to terminal 409", async () => {
  registerResult = { kind: "stale" };
  deactivateResult = { kind: "stale" };

  const postResponse = await route.POST(request("POST", validDevice));
  const deleteResponse = await route.DELETE(request("DELETE", {
    deviceId: validDevice.deviceId,
    bindingGeneration: 41,
  }));

  assert.equal(postResponse.status, 409);
  assert.deepEqual(await json(postResponse), {
    ok: false,
    error: "errors.deviceBindingStale",
  });
  assert.equal(deleteResponse.status, 409);
  assert.deepEqual(await json(deleteResponse), {
    ok: false,
    error: "errors.deviceBindingStale",
  });
});

await check("success responses echo the accepted binding generation", async () => {
  registerResult = { kind: "registered" };
  deactivateResult = { kind: "deactivated" };

  const postResponse = await route.POST(request("POST", validDevice));
  assert.equal(postResponse.status, 200);
  assert.deepEqual(await json(postResponse), {
    ok: true,
    data: { registered: true, bindingGeneration: 42 },
  });
  assert.equal(registerInput.principalId, gate.principalId);
  assert.equal(registerInput.storeId, gate.storeId);
  assert.equal(registerInput.effectiveUserId, gate.userId);
  assert.equal(registerInput.device.bindingGeneration, 42);

  const deleteResponse = await route.DELETE(request("DELETE", {
    deviceId: validDevice.deviceId,
    bindingGeneration: 43,
  }));
  assert.equal(deleteResponse.status, 200);
  assert.deepEqual(await json(deleteResponse), {
    ok: true,
    data: { unregistered: true, bindingGeneration: 43 },
  });
  assert.equal(deactivateInput.principalId, gate.principalId);
  assert.equal(deactivateInput.storeId, gate.storeId);
  assert.equal(deactivateInput.bindingGeneration, 43);
});

await check("malformed and unknown-device-compatible deletes keep existing behavior", async () => {
  deactivateInput = undefined;
  const malformed = await route.DELETE(request("DELETE", {
    deviceId: "short",
    bindingGeneration: 44,
  }));
  assert.equal(malformed.status, 400);
  assert.equal(deactivateInput, undefined);

  deactivateResult = { kind: "deactivated" };
  const unknownCompatible = await route.DELETE(request("DELETE", {
    deviceId: "unknown-device-is-idempotent",
    bindingGeneration: 44,
  }));
  assert.equal(unknownCompatible.status, 200);
  assert.deepEqual(await json(unknownCompatible), {
    ok: true,
    data: { unregistered: true, bindingGeneration: 44 },
  });
});

console.log(`\n${failed === 0 ? "🎉" : "⚠️"} ${passed} passed, ${failed} failed`);
if (failed > 0) process.exitCode = 1;
