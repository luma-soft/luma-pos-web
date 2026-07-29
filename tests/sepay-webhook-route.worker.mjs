import { createHmac } from "node:crypto";
import { mock } from "bun:test";

let currentAccount;
const recordCalls = [];
const matchCalls = [];

mock.module("@/db", () => ({
  db: {
    select() {
      return {
        from() {
          return {
            where() {
              return {
                async limit() {
                  return currentAccount ? [currentAccount] : [];
                },
              };
            },
          };
        },
      };
    },
  },
}));

mock.module("@/lib/payments/service", () => ({
  async recordSepayWebhookEvent(event, options) {
    recordCalls.push({ event, options });
    return {
      ok: true,
      data: {
        eventId: "00000000-0000-4000-8000-000000000901",
        duplicate: false,
      },
    };
  },
  async matchSepayWebhookEvent(eventId) {
    matchCalls.push(eventId);
    return { ok: true, data: { matched: true } };
  },
}));

const { POST } = await import("../src/app/api/payments/sepay/webhook/route.ts");

let passed = 0;
let failed = 0;
const ok = (name, condition) => {
  if (condition) {
    passed += 1;
    console.log(`  ✅ ${name}`);
  } else {
    failed += 1;
    console.log(`  ❌ ${name}`);
  }
};

const originalSecret = process.env.SEPAY_WEBHOOK_SECRET;
const originalApiKey = process.env.SEPAY_API_KEY;
delete process.env.SEPAY_WEBHOOK_SECRET;
delete process.env.SEPAY_API_KEY;

const accountNumber = "123123123";
const rawBody = JSON.stringify({
  id: "sepay-route-auth-event",
  account_number: accountNumber,
  amount: 1_000_000,
  content: "LUMA-ROUTE-AUTH",
});
const configuredSecret = "route-test-secret";
const configuredApiKey = "route-test-api-key";
const validSignature = createHmac("sha256", configuredSecret)
  .update(rawBody)
  .digest("hex");

function account({ secret, apiKey }) {
  const now = new Date("2026-07-29T00:00:00Z");
  return {
    id: "00000000-0000-4000-8000-000000000902",
    provider: "sepay",
    bankCode: "MBBank",
    gateway: "MBBank",
    accountNumber,
    subAccount: null,
    accountName: "Luma POS",
    isDefault: true,
    enabled: true,
    webhookEnabled: true,
    webhookSecret: secret,
    apiKey,
    note: null,
    createdBy: null,
    createdAt: now,
    updatedAt: now,
  };
}

async function runCase({
  name,
  secret = null,
  apiKey = null,
  signature,
  suppliedApiKey,
  expectedStatus,
  expectedError,
  shouldProcess,
}) {
  currentAccount = account({ secret, apiKey });
  recordCalls.length = 0;
  matchCalls.length = 0;

  const headers = new Headers({ "content-type": "application/json" });
  if (signature !== undefined) headers.set("x-sepay-signature", signature);
  if (suppliedApiKey !== undefined) headers.set("x-sepay-api-key", suppliedApiKey);
  const response = await POST(new Request("https://luma.test/api/payments/sepay/webhook", {
    method: "POST",
    headers,
    body: rawBody,
  }));
  const responseBody = await response.json();

  ok(
    name,
    response.status === expectedStatus
      && (expectedError === undefined || responseBody.error === expectedError)
      && (shouldProcess
        ? recordCalls.length === 1
          && recordCalls[0].options?.verified === true
          && matchCalls.length === 1
        : recordCalls.length === 0 && matchCalls.length === 0),
  );
}

try {
  await runCase({
    name: "secret-only valid signature is accepted",
    secret: configuredSecret,
    signature: validSignature,
    expectedStatus: 200,
    shouldProcess: true,
  });
  await runCase({
    name: "secret-only invalid signature is rejected before record or match",
    secret: configuredSecret,
    signature: "invalid-signature",
    expectedStatus: 401,
    expectedError: "errors.unauthorized",
    shouldProcess: false,
  });
  await runCase({
    name: "API-key-only valid key is accepted",
    apiKey: configuredApiKey,
    suppliedApiKey: configuredApiKey,
    expectedStatus: 200,
    shouldProcess: true,
  });
  await runCase({
    name: "API-key-only invalid key is rejected before record or match",
    apiKey: configuredApiKey,
    suppliedApiKey: "wrong-api-key",
    expectedStatus: 401,
    expectedError: "errors.unauthorized",
    shouldProcess: false,
  });
  await runCase({
    name: "both configured accept a valid signature",
    secret: configuredSecret,
    apiKey: configuredApiKey,
    signature: validSignature,
    suppliedApiKey: "wrong-api-key",
    expectedStatus: 200,
    shouldProcess: true,
  });
  await runCase({
    name: "both configured accept a valid API key",
    secret: configuredSecret,
    apiKey: configuredApiKey,
    signature: "invalid-signature",
    suppliedApiKey: configuredApiKey,
    expectedStatus: 200,
    shouldProcess: true,
  });
  await runCase({
    name: "both configured reject when neither credential validates",
    secret: configuredSecret,
    apiKey: configuredApiKey,
    signature: "invalid-signature",
    suppliedApiKey: "wrong-api-key",
    expectedStatus: 401,
    expectedError: "errors.unauthorized",
    shouldProcess: false,
  });
  await runCase({
    name: "missing webhook authentication configuration fails closed",
    expectedStatus: 503,
    expectedError: "errors.serverError",
    shouldProcess: false,
  });
} finally {
  if (originalSecret === undefined) delete process.env.SEPAY_WEBHOOK_SECRET;
  else process.env.SEPAY_WEBHOOK_SECRET = originalSecret;
  if (originalApiKey === undefined) delete process.env.SEPAY_API_KEY;
  else process.env.SEPAY_API_KEY = originalApiKey;
}

console.log(`\n${failed === 0 ? "🎉" : "⚠️"} ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
