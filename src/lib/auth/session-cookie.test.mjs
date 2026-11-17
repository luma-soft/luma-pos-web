import { expect, test } from "bun:test";
import { isDirectLoopbackHttpRequest } from "./session-cookie";

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
