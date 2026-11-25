import { expect, test } from "bun:test";
import { isDirectLoopbackHttpRequest, isLanHttpRequest } from "./session-cookie";

const req = (url, headers = {}) => new Request(url, { headers });

test("direct loopback http requests drop the Secure cookie flag", () => {
  expect(isDirectLoopbackHttpRequest(req("http://127.0.0.1:3000/api/auth/login", { host: "127.0.0.1:3000" }))).toBe(true);
  expect(isDirectLoopbackHttpRequest(req("http://localhost:3000/api/auth/login", { host: "localhost:3000" }))).toBe(true);
  expect(isDirectLoopbackHttpRequest(req("http://[::1]:3000/api/auth/login", { host: "[::1]:3000" }))).toBe(true);
});

test("tunnelled or public requests keep the Secure cookie flag", () => {
  expect(isDirectLoopbackHttpRequest(req("http://127.0.0.1:3000/api/auth/login", {
    host: "pos.haidangshop.com",
    "x-forwarded-proto": "https",
  }))).toBe(false);
  expect(isDirectLoopbackHttpRequest(req("http://127.0.0.1:3000/api/auth/login", {
    host: "127.0.0.1:3000",
    "x-forwarded-proto": "https",
  }))).toBe(false);
  expect(isDirectLoopbackHttpRequest(req("https://pos.haidangshop.com/api/auth/login", { host: "pos.haidangshop.com" }))).toBe(false);
});

test("LAN mode drops the Secure flag only for plain-http LAN hosts", () => {
  const lan = { LUMAPOS_LAN_HTTP: "true" };
  expect(isLanHttpRequest(req("http://haidang-mac.local:3000/", { host: "haidang-mac.local:3000" }), lan)).toBe(true);
  expect(isLanHttpRequest(req("http://192.168.1.20:3000/", { host: "192.168.1.20:3000" }), lan)).toBe(true);
  expect(isLanHttpRequest(req("http://10.0.0.5:3000/", { host: "10.0.0.5:3000" }), lan)).toBe(true);
  expect(isLanHttpRequest(req("http://172.20.1.1:3000/", { host: "172.20.1.1:3000" }), lan)).toBe(true);
  expect(isLanHttpRequest(req("http://8.8.8.8:3000/", { host: "8.8.8.8:3000" }), lan)).toBe(false);
  expect(isLanHttpRequest(req("http://172.32.0.1:3000/", { host: "172.32.0.1:3000" }), lan)).toBe(false);
  expect(isLanHttpRequest(req("http://127.0.0.1:3000/", {
    host: "pos.haidangshop.com",
    "x-forwarded-proto": "https",
  }), lan)).toBe(false);
  expect(isLanHttpRequest(req("http://haidang-mac.local:3000/", { host: "haidang-mac.local:3000" }), {})).toBe(false);
});
