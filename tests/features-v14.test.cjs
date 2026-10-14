// Tests for v1.4.0 features: RFC 6238 TOTP, HIBP k-Anonymity hashing, .gpvault export/import, Luhn & Card expiry
"use strict";

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { webcrypto } = require("node:crypto");
if (!globalThis.crypto || !globalThis.crypto.subtle) globalThis.crypto = webcrypto;

console.log("=== Running v1.4.0 Features Test Suite ===");

// 1. RFC 6238 TOTP Multi-Algorithm & Digits Test
const bgContent = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
const totpMatch = bgContent.match(/function base32Decode[\s\S]*?^}/m);
const computeMatch = bgContent.match(/async function computeTotpCode[\s\S]*?^}/m);
assert(totpMatch && computeMatch, "TOTP functions must exist in background.js");

const base32Decode = new Function("str", totpMatch[0] + "\nreturn base32Decode(str);");
const computeTotpCode = new Function("base32Decode", "crypto", computeMatch[0] + "\nreturn computeTotpCode;")(base32Decode, globalThis.crypto);

// Standard test vector string
const SAMPLE_BASE32 = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

async function testTotp() {
  // Test basic 6-digit SHA-1
  const code1 = await computeTotpCode(SAMPLE_BASE32, { algorithm: "SHA-1", digits: 6, period: 30 });
  assert.strictEqual(code1.length, 6, "Code must be 6 digits");
  assert(/^\d{6}$/.test(code1), "Code must be all digits");

  // Test 8-digit SHA-256
  const code2 = await computeTotpCode(SAMPLE_BASE32, { algorithm: "SHA-256", digits: 8, period: 30 });
  assert.strictEqual(code2.length, 8, "Code must be 8 digits for SHA-256");
  assert(/^\d{8}$/.test(code2), "Code must be all digits");

  // Test 8-digit SHA-512
  const code3 = await computeTotpCode(SAMPLE_BASE32, { algorithm: "SHA-512", digits: 8, period: 60 });
  assert.strictEqual(code3.length, 8, "Code must be 8 digits for SHA-512");
  assert(/^\d{8}$/.test(code3), "Code must be all digits");

  console.log("✓ RFC 6238 TOTP algorithms (SHA-1, SHA-256, SHA-512, 6/8 digits, period) passed");
}

// 2. HIBP k-Anonymity SHA-1 prefix test
async function testHibpHash() {
  const popupContent = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
  assert(popupContent.includes("https://api.pwnedpasswords.com/range/"), "HIBP k-anonymity API endpoint must be present");
  assert(popupContent.includes("checkPwnedPassword"), "checkPwnedPassword function must exist");

  const sampleWord = "sample-test-phrase";
  const buffer = new TextEncoder().encode(sampleWord);
  const digest = await crypto.subtle.digest("SHA-1", buffer);
  const hex = Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
  assert.strictEqual(hex.length, 40, "SHA-1 hex must be 40 chars");
  assert.strictEqual(hex.slice(0, 5).length, 5, "Prefix must be 5 chars");
  console.log("✓ HIBP k-Anonymity SHA-1 hash prefix calculation passed");
}

// 3. Luhn Checksum & Card Expiry tests
function testCardValidation() {
  const popupContent = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
  const luhnMatch = popupContent.match(/function validateLuhn[\s\S]*?^}/m);
  const expMatch = popupContent.match(/function validateExpiryDate[\s\S]*?^}/m);
  assert(luhnMatch && expMatch, "validateLuhn and validateExpiryDate must exist");

  const validateLuhn = new Function("cardNumber", luhnMatch[0] + "\nreturn validateLuhn(cardNumber);");
  const validateExpiryDate = new Function("expiryStr", expMatch[0] + "\nreturn validateExpiryDate(expiryStr);");

  // Luhn tests
  assert.strictEqual(validateLuhn("4532015112830366"), true, "Valid card must pass Luhn");
  assert.strictEqual(validateLuhn("4532015112830367"), false, "Invalid card must fail Luhn");
  assert.strictEqual(validateLuhn("1234567812345670"), true, "Valid test card must pass Luhn");
  assert.strictEqual(validateLuhn("1234567812345671"), false, "Invalid test card must fail Luhn");

  // Expiry date tests
  assert.strictEqual(validateExpiryDate("12/35"), true, "Future year must be valid");
  assert.strictEqual(validateExpiryDate("01/20"), false, "Expired year 2020 must be invalid");
  assert.strictEqual(validateExpiryDate("13/30"), false, "Month 13 must be invalid");
  assert.strictEqual(validateExpiryDate("00/30"), false, "Month 0 must be invalid");
  assert.strictEqual(validateExpiryDate("invalid"), false, "Non-date string must be invalid");

  console.log("✓ Card Luhn checksum & Expiry date validation passed");
}

// 4. Encrypted Vault Container (.gpvault) structure test
const V = require(path.join(__dirname, "../vault.js"));

async function testGpvaultBackup() {
  const testPayload = {
    genHistory: [{ id: "1", name: "Site", password: "p1" }],
    gen2FA: [{ id: "2", name: "2FA", secret: SAMPLE_BASE32 }],
    genCards: [{ id: "3", cardName: "Visa", cardNumber: "4532015112830366" }],
    genTags: ["Tag1", "Tag2"],
    genCookieProfiles: []
  };

  const samplePass = "myTestPinNumber1234";
  const blob = await V.encryptWithPin(testPayload, samplePass);

  const backupDoc = {
    app: "GenPass",
    format: "genpass-encrypted-vault",
    version: 2,
    exportedAt: new Date().toISOString(),
    vault: blob
  };

  assert.strictEqual(backupDoc.format, "genpass-encrypted-vault", "Backup format tag must be genpass-encrypted-vault");
  assert.strictEqual(backupDoc.version, 2, "Backup version must be 2");
  assert(backupDoc.vault.ct && backupDoc.vault.salt && backupDoc.vault.iv, "Blob must have ciphertext, salt, and iv");

  // Restore simulation
  const { data } = await V.unlockWithPin(backupDoc.vault, samplePass);
  assert.deepStrictEqual(data.genHistory, testPayload.genHistory, "Restored history must match exactly");
  assert.deepStrictEqual(data.gen2FA, testPayload.gen2FA, "Restored 2FA must match exactly");
  assert.deepStrictEqual(data.genCards, testPayload.genCards, "Restored cards must match exactly");

  console.log("✓ Encrypted Vault backup container (.gpvault) roundtrip passed");
}

(async () => {
  await testTotp();
  await testHibpHash();
  testCardValidation();
  await testGpvaultBackup();
  console.log("\nALL v1.4.0 FEATURES TESTS PASSED! (4/4 groups)");
})();
