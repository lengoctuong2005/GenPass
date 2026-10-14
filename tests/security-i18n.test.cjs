// Unit tests for Security Hardening (SSRF filter, PIN rate limit) and i18n / About support
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== Running Security & i18n Test Suite ===");

// 1. SSRF Filter extracted from background.js
const bgContent = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
const isSafeMatch = bgContent.match(/function isSafeFetchUrl\([\s\S]*?^}/m);
assert(isSafeMatch, "isSafeFetchUrl function must exist in background.js");

const isSafeFetchUrl = new Function("urlStr", isSafeMatch[0] + "\nreturn isSafeFetchUrl(urlStr);");

// SSRF Tests
assert.strictEqual(isSafeFetchUrl("http://127.0.0.1/admin"), false, "Must block 127.0.0.1");
assert.strictEqual(isSafeFetchUrl("http://127.1.2.3:8080"), false, "Must block 127.* range");
assert.strictEqual(isSafeFetchUrl("http://localhost:3000/api"), false, "Must block localhost");
assert.strictEqual(isSafeFetchUrl("http://0.0.0.0:80/"), false, "Must block 0.0.0.0");
assert.strictEqual(isSafeFetchUrl("http://192.168.1.1/router"), false, "Must block 192.168.*");
assert.strictEqual(isSafeFetchUrl("http://10.200.0.5/"), false, "Must block 10.*");
assert.strictEqual(isSafeFetchUrl("http://172.16.0.1/"), false, "Must block 172.16.*");
assert.strictEqual(isSafeFetchUrl("http://172.31.255.255/"), false, "Must block 172.31.*");
assert.strictEqual(isSafeFetchUrl("http://169.254.169.254/latest/meta-data"), false, "Must block cloud metadata 169.254.*");
assert.strictEqual(isSafeFetchUrl("http://sub.local/"), false, "Must block .local domains");
assert.strictEqual(isSafeFetchUrl("http://internal.localhost/"), false, "Must block .localhost domains");
assert.strictEqual(isSafeFetchUrl("ftp://example.com/file"), false, "Must block non-http/https/data/blob protocols");
assert.strictEqual(isSafeFetchUrl("javascript:alert(1)"), false, "Must block javascript: uri");
assert.strictEqual(isSafeFetchUrl("http://[::ffff:127.0.0.1]/qr.png"), false, "Must block IPv6-mapped 127.0.0.1");
assert.strictEqual(isSafeFetchUrl("http://[::ffff:169.254.169.254]/latest"), false, "Must block IPv6-mapped metadata");
assert.strictEqual(isSafeFetchUrl("http://[::]/qr.png"), false, "Must block unspecified IPv6 ::");

// Allowed safe URLs
assert.strictEqual(isSafeFetchUrl("data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=="), true, "Must allow data URI");
assert.strictEqual(isSafeFetchUrl("blob:chrome-extension://abcdef/123-456"), true, "Must allow blob URI");
assert.strictEqual(isSafeFetchUrl("https://img.vietqr.io/image/TCB-1005555555555-qr_only.png"), true, "Must allow public https domain");
assert.strictEqual(isSafeFetchUrl("https://raw.githubusercontent.com/lengoctuong2005/GenPass/main/manifest.json"), true, "Must allow github raw");
console.log("✓ SSRF filter tests passed (17/17)");

// 2. Donate Info verification from popup.js
const popupContent = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
assert(popupContent.includes("1005555555555"), "DONATE_INFO must contain account number from vibe-hub");
assert(popupContent.includes("Techcombank"), "DONATE_INFO must contain Techcombank");
assert(popupContent.includes("LE NGOC TUONG"), "DONATE_INFO must contain LE NGOC TUONG");
assert(popupContent.includes("https://github.com/lengoctuong2005/GenPass"), "GITHUB_URL must point to official GenPass repo");
console.log("✓ Donate & GitHub verification passed");

// 3. i18n Dictionaries completeness check
const i18nMatch = popupContent.match(/const I18N = (\{[\s\S]*?\n  \});/);
assert(i18nMatch, "I18N dictionary must exist in popup.js");
const I18N = new Function("return " + i18nMatch[1])();

assert(I18N.vi && I18N.en, "Must have vi and en dictionaries");
const viKeys = Object.keys(I18N.vi);
const enKeys = Object.keys(I18N.en);
assert(viKeys.length >= 40, `VI dictionary must have sufficient keys (found ${viKeys.length})`);
assert(enKeys.length >= 40, `EN dictionary must have sufficient keys (found ${enKeys.length})`);

for (const k of viKeys) {
  assert(enKeys.includes(k), `Missing English translation for key: "${k}"`);
}
console.log(`✓ i18n dictionary completeness passed (${viKeys.length} matching bilingual keys)`);

// 4. Rate limiting logic check
assert(popupContent.includes("vaultLockoutUntil"), "vaultLockoutUntil rate-limit variable must exist");
assert(popupContent.includes("vaultFailedAttempts"), "vaultFailedAttempts counter must exist");
console.log("✓ Vault PIN rate-limiting logic present");

console.log("\nALL SECURITY & i18n TESTS PASSED! (4/4 test groups)");
