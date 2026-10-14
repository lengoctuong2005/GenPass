// Unit tests for the Quick Snippets (Text Expansion) feature
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

console.log("=== Running Quick Snippets (Text Expansion) Test Suite ===");

const content = fs.readFileSync(path.join(__dirname, "../content.js"), "utf8");
const popup = fs.readFileSync(path.join(__dirname, "../popup.js"), "utf8");
const popupHtml = fs.readFileSync(path.join(__dirname, "../popup.html"), "utf8");
const contentCss = fs.readFileSync(path.join(__dirname, "../content.css"), "utf8");
const bg = fs.readFileSync(path.join(__dirname, "../background.js"), "utf8");

// --- 1. Snippet functions extracted from content.js ---
const snippetMatch = content.match(/\/\/ --- Quick Snippets[\s\S]*?\n  \/\/ Init badges/);
assert(snippetMatch, "content.js must contain the Quick Snippets section");

const SNIPPET_SRC = snippetMatch[0];

function loadSnippets() {
  return new Function(`
    ${SNIPPET_SRC}
    return {
      getWord: getWordAtCursor,
      match: matchSnippets,
      apply: applySnippet,
      isTarget: isSnippetTarget
    };
  `)();
}

const S = loadSnippets();

// a) getWordAtCursor
const t1 = S.getWord({ value: "hello eml", selectionStart: 9 });
assert.strictEqual(t1.word, "eml", "Word at cursor at end must be 'eml'");
assert.strictEqual(t1.start, 6, "Start index must be 6");
assert.strictEqual(t1.end, 9, "End index must be 9");

const t2 = S.getWord({ value: "xin chao /mail ban", selectionStart: 14 });
assert.strictEqual(t2.word, "/mail", "Word at cursor in middle must be '/mail'");
assert.strictEqual(t2.start, 9, "Start index must be 9");
assert.strictEqual(t2.end, 14, "End index must be 14");

const t3 = S.getWord({ value: "sdt", selectionStart: 3 });
assert.strictEqual(t3.word, "sdt", "Single word must be extracted");
assert.strictEqual(t3.start, 0);
assert.strictEqual(t3.end, 3);
console.log("✓ getWordAtCursor token extraction passed (3/3)");

// b) matchSnippets
const sampleSnippets = [
  { id: "1", shortcut: "eml", value: "test@example.com", label: "Email" },
  { id: "2", shortcut: "sdt", value: "0912345678", label: "Phone" },
  { id: "3", shortcut: "/address", value: "Hanoi, Vietnam", label: "Address" }
];

// Exact match
const m1 = S.match("eml", sampleSnippets);
assert.strictEqual(m1.length, 1);
assert.strictEqual(m1[0].value, "test@example.com");

// Case insensitive match
const m2 = S.match("EML", sampleSnippets);
assert.strictEqual(m2.length, 1);

// Prefix match (length >= 2)
const m3 = S.match("em", sampleSnippets);
assert.strictEqual(m3.length, 1);
assert.strictEqual(m3[0].shortcut, "eml");

// Slash prefix match
const m4 = S.match("/addr", sampleSnippets);
assert.strictEqual(m4.length, 1);
assert.strictEqual(m4[0].shortcut, "/address");

// Non-match
const m5 = S.match("xyz", sampleSnippets);
assert.strictEqual(m5.length, 0);

// Single char should not prefix-match
const m6 = S.match("e", sampleSnippets);
assert.strictEqual(m6.length, 0);
console.log("✓ matchSnippets exact, prefix & case-insensitivity passed (6/6)");

// c) isSnippetTarget security boundaries
assert.strictEqual(S.isTarget({ type: "password" }), false, "Must never target password inputs");
assert.strictEqual(S.isTarget({ type: "hidden" }), false, "Must never target hidden inputs");
assert.strictEqual(S.isTarget({ type: "text", readOnly: true }), false, "Must not target readonly inputs");
assert.strictEqual(S.isTarget({ type: "text", disabled: true }), false, "Must not target disabled inputs");

// Allowed targets (simulating HTMLInputElement / HTMLTextAreaElement via duck-typing)
function stubInput(type, isTextArea = false) {
  const base = { type: type || "", readOnly: false, disabled: false };
  if (isTextArea) {
    Object.setPrototypeOf(base, (typeof HTMLTextAreaElement !== "undefined" ? HTMLTextAreaElement.prototype : Object.prototype));
  }
  return base;
}

assert.strictEqual(S.isTarget({ type: "text", readOnly: false, disabled: false }), true, "Must target text input");
assert.strictEqual(S.isTarget({ type: "email", readOnly: false, disabled: false }), true, "Must target email input");
assert.strictEqual(S.isTarget({ type: "tel", readOnly: false, disabled: false }), true, "Must target tel input");
assert.strictEqual(S.isTarget({ type: "search", readOnly: false, disabled: false }), true, "Must target search input");
console.log("✓ isSnippetTarget security & input types passed (8/8)");

// --- 2. Popup UI & Options wiring ---
assert(popupHtml.includes('id="tab-snippets"'), "popup.html must declare tab-snippets");
assert(popupHtml.includes('id="view-snippets"'), "popup.html must declare view-snippets");
assert(popupHtml.includes('id="opt-snippets"'), "popup.html must declare opt-snippets toggle");
assert(popupHtml.includes('id="input-snippet-shortcut"'), "popup.html must declare input-snippet-shortcut");
assert(popupHtml.includes('id="input-snippet-value"'), "popup.html must declare input-snippet-value");

assert(popup.includes("tabSnippets: document.getElementById(\"tab-snippets\")"), "popup.js must wire tabSnippets");
assert(popup.includes("viewSnippets: document.getElementById(\"view-snippets\")"), "popup.js must wire viewSnippets");
assert(popup.includes("optSnippets: document.getElementById(\"opt-snippets\")"), "popup.js must wire optSnippets");
assert(popup.includes("snippetsEnabled: els.optSnippets ? els.optSnippets.checked : true"), "getOptions must include snippetsEnabled");
assert(popup.includes("function renderSnippets()"), "popup.js must define renderSnippets");
assert(popup.includes("function saveSnippets()"), "popup.js must define saveSnippets");
console.log("✓ popup.html / popup.js snippets wiring passed (11/11)");

// --- 3. Background Vault Integration ---
assert(bg.includes('"genSnippets"'), "background.js VAULT_KEYS must include genSnippets");
assert(popup.includes('"genSnippets"'), "popup.js vault keys must include genSnippets");
console.log("✓ background & popup encrypted vault integration passed (2/2)");

// --- 4. CSS Shielding ---
assert(contentCss.includes("#genpass-snippet-bubble"), "content.css must style #genpass-snippet-bubble");
assert(contentCss.includes("all: initial"), "snippet bubble must reset with all: initial");
assert(contentCss.includes(".gpb-badge"), "snippet bubble must style .gpb-badge");
assert(contentCss.includes("@media (prefers-color-scheme: dark)"), "content.css must support dark mode for snippet bubble");
console.log("✓ content.css snippet bubble shielding passed (4/4)");

console.log("\nALL QUICK SNIPPETS TESTS PASSED! (4/4 test groups)");
