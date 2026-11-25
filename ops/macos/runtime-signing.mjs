#!/usr/bin/env bun
// Ed25519 signatures for LumaPOS runtime packages (phase 5 release).
//
//   bun ops/macos/runtime-signing.mjs keygen
//       Creates the private key (outside the repository) and prints the
//       public key the Mac app embeds (base64, raw 32 bytes).
//   bun ops/macos/runtime-signing.mjs public-key
//   bun ops/macos/runtime-signing.mjs sign <lumapos-runtime-<version>.tar.gz>
//       Writes <archive>.sig (base64) over the signed message below, using
//       the SHA-256 in <archive>.sha256.
//   bun ops/macos/runtime-signing.mjs verify <archive> <public-key-base64>
//
// Signed message (UTF-8): "LUMAPOS-RUNTIME-1\n<version>\n<sha256>\n". The app
// checks the signature, then passes the SHA-256 to `lumapos-admin
// install-runtime`, which checks the archive against it.
//
// The key lives at $LUMAPOS_RUNTIME_SIGNING_KEY or
// ~/Library/Application Support/LumaPOS/release/runtime-signing-ed25519.pem.
// Keep a copy in a password manager: an app built with a new public key is
// needed if it is lost.
import { createHash, createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const keyPath = process.env.LUMAPOS_RUNTIME_SIGNING_KEY
  ?? path.join(homedir(), "Library/Application Support/LumaPOS/release/runtime-signing-ed25519.pem");
const ARCHIVE_PATTERN = /^lumapos-runtime-([0-9]{8}\.[0-9]{6}-[0-9a-f]{8})\.tar\.gz$/;

function fail(message) {
  console.error(message);
  process.exit(1);
}

function rawPublicKey(publicKey) {
  // SPKI DER for Ed25519 ends with the 32-byte key.
  return publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
}

export function signedMessage(version, sha256) {
  return Buffer.from(`LUMAPOS-RUNTIME-1\n${version}\n${sha256}\n`, "utf8");
}

function archiveFacts(archive) {
  const match = path.basename(archive).match(ARCHIVE_PATTERN);
  if (!match) fail("The archive must be named lumapos-runtime-<yyyymmdd.hhmmss-commit8>.tar.gz");
  const checksumFile = `${archive}.sha256`;
  if (!existsSync(checksumFile)) fail(`Missing ${checksumFile}`);
  const sha256 = readFileSync(checksumFile, "utf8").trim().split(/\s+/)[0];
  if (!/^[0-9a-f]{64}$/.test(sha256)) fail(`${checksumFile} has no SHA-256`);
  const actual = createHash("sha256").update(readFileSync(archive)).digest("hex");
  if (actual !== sha256) fail("The archive does not match its .sha256 file");
  return { version: match[1], sha256 };
}

function privateKey() {
  if (!existsSync(keyPath)) fail(`No signing key at ${keyPath} (run keygen)`);
  return createPrivateKey(readFileSync(keyPath));
}

const [command, ...args] = process.argv.slice(2);
switch (command) {
  case "keygen": {
    if (existsSync(keyPath)) fail(`A key already exists at ${keyPath}`);
    mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    const { privateKey: key, publicKey } = generateKeyPairSync("ed25519");
    writeFileSync(keyPath, key.export({ format: "pem", type: "pkcs8" }), { mode: 0o600, flag: "wx" });
    chmodSync(keyPath, 0o600);
    console.log(rawPublicKey(publicKey));
    break;
  }
  case "public-key":
    console.log(rawPublicKey(createPublicKey(privateKey())));
    break;
  case "sign": {
    const [archive] = args;
    if (!archive) fail("Usage: sign <archive>");
    const { version, sha256 } = archiveFacts(archive);
    const signature = sign(null, signedMessage(version, sha256), privateKey()).toString("base64");
    writeFileSync(`${archive}.sig`, `${signature}\n`, { mode: 0o644 });
    console.log(`${archive}.sig`);
    break;
  }
  case "verify": {
    const [archive, publicKeyBase64] = args;
    if (!archive || !publicKeyBase64) fail("Usage: verify <archive> <public-key-base64>");
    const { version, sha256 } = archiveFacts(archive);
    const der = Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(publicKeyBase64, "base64")]);
    const publicKey = createPublicKey({ key: der, format: "der", type: "spki" });
    const signature = Buffer.from(readFileSync(`${archive}.sig`, "utf8").trim(), "base64");
    if (!verify(null, signedMessage(version, sha256), publicKey, signature)) fail("Signature does not match");
    console.log("valid");
    break;
  }
  default:
    fail("Usage: runtime-signing.mjs keygen | public-key | sign <archive> | verify <archive> <public-key>");
}
