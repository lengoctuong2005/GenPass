// Unit tests for the "suggest a strong password on empty signup fields" feature (content script + popup wiring)
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== Running Suggest-Password Test Suite ===");

const content = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
const popup = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
const popupHtml = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
const css = fs.readFileSync(path.join(__dirname, "../content.css"), "utf8");

// --- 1. Helpers & detector: extract the whole suggest section from content.js and run it in a sandbox ---
const sectionMatch = content.match(/\/\/ --- Goi y mat khau manh[\s\S]*?\n  \/\/ Init badges \+ suggest password/);
assert(sectionMatch, "content.js must contain the suggest-password section");
const SUGGEST_SRC = sectionMatch[0];

function loadSuggest() {
  return new Function(`
    ${SUGGEST_SRC}
    return {
      suggest: generateStrongSuggestion,
      looksLike: looksLikeNewPasswordField,
      findConfirm: findSuggestConfirmField,
      findPrimary: findSuggestPrimaryField,
      isConfirm: isConfirmField,
      close: closeSuggestBubble,
      show: showSuggestBubble,
      init: initSuggestPassword,
      pools: SUGGEST_POOLS,
      i18n: SUGGEST_I18N
    };
  `)();
}

const S = loadSuggest();

// --- 2. looksLikeNewPasswordField: signup yes, login no ---
function stubPassword(opts = {}) {
  const attrs = opts.attrs || {};
  return {
    type: "password",
    name: opts.name || "",
    id: opts.id || "",
    placeholder: opts.placeholder || "",
    autocomplete: opts.autocomplete || "",
    value: opts.value || "",
    form: opts.form,
    getAttribute: (k) => (k === "aria-label" ? opts.ariaLabel : attrs[k]),
    closest: () => null
  };
}

// a) autocomplete new-password
assert.strictEqual(
  S.looksLike(stubPassword({ autocomplete: "new-password", name: "pw" })),
  true,
  "autocomplete=new-password must be detected as a new password field"
);
assert.strictEqual(
  S.looksLike(stubPassword({ autocomplete: "new_password", name: "pw" })),
  true,
  "autocomplete=new_password must be detected as a new password field"
);

// b) name/placeholder keywords
assert.strictEqual(
  S.looksLike(stubPassword({ name: "new_password" })),
  true,
  "name=new_password must be detected"
);
assert.strictEqual(
  S.looksLike(stubPassword({ placeholder: "New password" })),
  true,
  "placeholder 'New password' must be detected"
);
assert.strictEqual(
  S.looksLike(stubPassword({ id: "mat-khau-moi" })),
  true,
  "Vietnamese id 'mat-khau-moi' must be detected"
);

// c) login form: single password field, nothing to suggest
assert.strictEqual(
  S.looksLike(stubPassword({ name: "password" })),
  false,
  "single bare password field with no signup text must NOT trigger (login form)"
);
assert.strictEqual(
  S.looksLike(stubPassword({ autocomplete: "current-password", name: "password" })),
  false,
  "autocomplete=current-password (login) must never trigger"
);
assert.strictEqual(
  S.looksLike(stubPassword({ value: "hunter2" })),
  false,
  "field the user already typed in must never trigger"
);

// d) classic signup form: 2 password inputs, first is the new one
const signupConfirm = stubPassword({ name: "confirm_password" });
const signupPassword = stubPassword({ name: "password", form: { querySelectorAll: () => [signupPassword, signupConfirm] } });
assert.strictEqual(S.looksLike(signupPassword), true, "first of two password boxes next to a confirm box must trigger");

// e) the confirm box itself must not re-trigger
assert.strictEqual(
  S.looksLike(signupConfirm),
  false,
  "confirm field itself must not re-trigger the suggestion"
);

// f) confirm field finder
assert.strictEqual(S.findConfirm(signupPassword), signupConfirm, "confirm field finder must return the sibling confirm input");
assert.strictEqual(S.findConfirm(signupConfirm), null, "confirm field finder returns null when there is no confirm sibling");

// g) formless page without any keyword stays quiet
assert.strictEqual(
  S.looksLike(stubPassword({ name: "password", form: { querySelectorAll: () => [] } })),
  false,
  "formless/known-signal-free field must not trigger"
);
console.log("✓ looksLikeNewPasswordField signup/login discrimination passed (10/10)");

// --- 3. generateStrongSuggestion: clamps, charset guarantees ---
const p = S.pools;
assert.strictEqual(S.suggest({ length: 6 }).length, 12, "length 6 must clamp up to 12");
assert.strictEqual(S.suggest({ length: 999 }).length, 64, "length 999 must clamp down to 64");
assert.strictEqual(S.suggest().length, 16, "missing options must fall back to 16");
assert.strictEqual(S.suggest({ length: "24" }).length, 24, "string length must be parsed");
assert.strictEqual(S.suggest({ length: 20, upper: false }).length, 20, "disabled class must not break the length");
console.log("✓ generateStrongSuggestion length clamp passed (5/5)");

const upperRe = new RegExp(`[${p.upper}]`);
const lowerRe = new RegExp(`[${p.lower}]`);
const digitRe = new RegExp(`[${p.numbers}]`);
const specialRe = new RegExp(`[${p.special}]`);
const alnumOnlyRe = new RegExp(`^[${p.alphanum}]+$`);

S.i18n; // i18n table exists and is bilingual
assert.deepStrictEqual(Object.keys(S.i18n).sort(), ["en", "vi"], "bubble i18n must have vi and en");
for (const lang of ["vi", "en"]) {
  const keys = ["title", "body", "btnOwn", "btnUse", "savedToast", "reusedToast", "lockedToast"];
  for (const k of keys) {
    assert(S.i18n[lang][k], `i18n.${lang}.${k} must exist`);
  }
  assert(S.i18n[lang].body.includes("{who}"), `i18n.${lang}.body must carry the {who} placeholder`);
  assert(S.i18n[lang].savedToast.includes("{domain}"), `i18n.${lang}.savedToast must carry the {domain} placeholder`);
}
console.log("✓ SUGGEST_I18N billing/keys passed (2 langs x 7 keys)");

let okLength = true;
let okClasses = true;
let okStdPool = true;
for (let i = 0; i < 200; i++) {
  const pass = S.suggest({});
  if (pass.length !== 16) okLength = false;
  if (!upperRe.test(pass) || !lowerRe.test(pass) || !digitRe.test(pass) || !specialRe.test(pass)) okClasses = false;
  for (const ch of pass) {
    if (!p.std.includes(ch)) okStdPool = false;
  }
}
assert(okLength, "every generated password must honour the requested length");
assert(okClasses, "every generated password must contain upper, lower, digit and special");
assert(okStdPool, "every character must come from the shared pool (no ambiguous l/1/I/O/0/B/8)");
console.log("✓ generateStrongSuggestion 200 random draws passed (length + 4 classes + pool)");

// special disabled -> alphanumerics only
let alnumOk = true;
for (let i = 0; i < 50; i++) {
  const pass = S.suggest({ special: false, length: 18 });
  if (pass.length !== 18 || !alnumOnlyRe.test(pass)) alnumOk = false;
}
assert(alnumOk, "special=false must produce alphanumerics only");
console.log("✓ alphanumeric-only mode passed (50 draws)");

// --- 4. Popup wiring ---
assert(popupHtml.includes('id="opt-suggest-password"'), "popup.html must declare the opt-suggest-password checkbox");
assert(popup.includes("optSuggestPassword: document.getElementById(\"opt-suggest-password\")"),
  "popup.js els map must wire optSuggestPassword");
assert(popup.includes("suggestStrongPassword: els.optSuggestPassword.checked,"),
  "getOptions must persist suggestStrongPassword");
assert(popup.includes("els.optSuggestPassword.checked = o.suggestStrongPassword !== false;"),
  "loadOptions must restore suggestStrongPassword (default on)");
assert(popup.includes('els.optSuggestPassword.addEventListener("change"'),
  "popup.js must attach the change listener for the new toggle");
assert(popup.includes("Đã bật gợi ý mật khẩu mạnh khi đăng ký!"),
  "popup.js must toast the Vietnamese on/off messages");
console.log("✓ popup.html / popup.js wiring passed (6/6)");

// --- 5. Content script guards ---
assert(content.includes("suggestStrongPassword === false"), "content.js must honour the feature toggle off");
assert(content.includes("genpassSuggestDismissed"), "content.js must respect the per-field dismiss flag");
assert(content.includes("setNativeValue(passInput, \"\")"), "content.js must revert the field on 'Choose your own'");
assert(content.includes('"new-password"'), "content.js must check the new-password autocomplete token");
assert(content.includes("el.value === \"\""), "content.js must only suggest on an empty field");
assert(content.includes("genpassSuggestBound"), "content.js must bind the input listener once per field");
assert(content.includes("activeSuggestBubble"), "content.js must keep a single active bubble reference");
assert(content.includes("30000"), "bubble must auto-close after 30s");
assert(/\/\/ ponytail:/.test(content), "deliberate shortcuts stay marked for the reviewer");
console.log("✓ content.js feature guards passed (8/8)");

// --- 6. Stylesheet shielding ---
assert(css.includes("#genpass-suggest-bubble"), "content.css must style the bubble root");
assert(css.includes("all: initial"), "bubble root must reset page CSS with all: initial");
assert(css.includes("@media (prefers-color-scheme: dark)"), "content.css must keep the dark-mode block");
assert(css.includes("2147483646"), "bubble must sit below the toast/dialog z-index");
assert(css.includes("gps-btn-own"), "secondary 'Choose your own' button style must exist");
assert(css.includes("gps-btn-use"), "primary 'Use strong password' button style must exist");
console.log("✓ content.css shielding passed (6/6)");

// --- 7. Pool parity with the context-menu generator in background.js ---
const bg = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");
const bgPools = bg.match(/const POOLS = \{[\s\S]*?\};/);
assert(bgPools, "background.js must still declare its POOLS table");
assert.strictEqual(S.pools.std, bg.match(/std: "([^"]+)"/)[1],
  "suggest pool std must stay identical to POOLS.std in background.js");
assert.strictEqual(S.pools.alphanum, bg.match(/alphanum: "([^"]+)"/)[1],
  "suggest pool alphanum must stay identical to POOLS.alphanum in background.js");
assert.strictEqual(S.pools.std, S.pools.upper + S.pools.lower + S.pools.numbers + S.pools.special,
  "class pools must compose the std pool (no missing or extra characters)");
console.log("✓ pool parity with background.js passed (3/3)");

// --- 8. Vault-locked save: that bai ghi thi phai bao that, khong bao "da luu" ---
const useHandler = content.match(/node\.querySelector\("\.gps-btn-use"\)\.addEventListener\("click", \(\) => \{[\s\S]*?\n    \}\);/);
assert(useHandler, "content.js must still contain the gps-btn-use click handler");
assert(/gpSet\(\{ genHistory: history \}, \(res\) =>/.test(useHandler[0]),
  "the suggest save must receive the gpSet response argument");
assert(/res\s*&&\s*res\.locked/.test(useHandler[0]),
  "the suggest save must inspect res.locked (vault_put -> { ok: false, locked: true })");
assert(useHandler[0].includes("t.savedToast.replace"), "the non-locked branch must keep the saved toast");
assert(S.i18n.vi.lockedToast, "i18n.vi.lockedToast must exist");
assert(S.i18n.en.lockedToast, "i18n.en.lockedToast must exist");
console.log("✓ vault-locked save toast passed (6/6)");

// --- 9. SPA / Angular Material formless & label-based confirm detection ---
// a) Angular Material outline input with <mat-label> inside container and no form
const matLabelEl = { textContent: "Confirm Password" };
const matContainer = {
  querySelector: (sel) => (sel.includes("mat-label") ? matLabelEl : null)
};
let cardContainer = null;
const angularConfirm = {
  type: "password",
  id: "mat-input-1",
  closest: (sel) => (sel.includes("mat-form-field") ? matContainer : (sel.includes("card") ? cardContainer : null)),
  getAttribute: () => null,
  labels: []
};
const angularPass = {
  type: "password",
  id: "mat-input-0",
  closest: (sel) => (sel.includes("card") ? cardContainer : null),
  getAttribute: () => null,
  labels: []
};
cardContainer = {
  querySelectorAll: () => [angularPass, angularConfirm]
};

assert.strictEqual(S.looksLike(angularPass), true, "primary field in Angular Material card must trigger suggestion");
assert.strictEqual(S.looksLike(angularConfirm), false, "confirm field in Angular Material card must NOT re-trigger suggestion");
assert.strictEqual(S.findConfirm(angularPass), angularConfirm, "findConfirm must resolve Angular Material confirm input");
assert.strictEqual(S.findConfirm(angularConfirm), null, "confirm input must have no confirm sibling");
assert.strictEqual(S.findPrimary(angularConfirm), angularPass, "findPrimary must resolve primary field from confirm input");

// b) Pair fallback when 2 password fields exist with no keywords at all
let genericContainer = null;
const genericPass1 = { type: "password", id: "p1", closest: () => genericContainer, getAttribute: () => null };
const genericPass2 = { type: "password", id: "p2", closest: () => genericContainer, getAttribute: () => null };
genericContainer = { querySelectorAll: () => [genericPass1, genericPass2] };

assert.strictEqual(S.looksLike(genericPass1), true, "1st of 2 generic password fields in signup container must trigger");
assert.strictEqual(S.looksLike(genericPass2), false, "2nd of 2 generic password fields must NOT trigger (it is confirm)");
assert.strictEqual(S.findConfirm(genericPass1), genericPass2, "1st field must pair with 2nd field as confirm");
assert.strictEqual(S.findConfirm(genericPass2), null, "2nd field must not have a confirm field");
assert.strictEqual(S.findPrimary(genericPass2), genericPass1, "findPrimary must resolve 1st field from 2nd generic field");
console.log("✓ SPA / Angular Material & generic 2-box pairing passed (10/10)");

console.log("\nALL SUGGEST-PASSWORD TESTS PASSED! (11/11 test groups)");
