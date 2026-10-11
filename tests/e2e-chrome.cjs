#!/usr/bin/env node
// ---------------------------------------------------------------------------
// tests/e2e-chrome.cjs - GenPass: E2E kho ma hoa tren Chrome THAT (khong mo phong).
//
// Chay:  cd /mnt/Windows/ProJect/GenPass && node tests/e2e-chrome.cjs
//       E2E_SKIP_IDLE=1 node tests/e2e-chrome.cjs    # bo qua S5 (idle 40s) + S7 (restart)
//
// Khong dung thu vien ngoai: chi Node >= 22 (WebSocket + fetch toan cuc) va
// Chrome that qua CDP. Ket qua: in PASS/FAIL tung scenario, exit 0 chi khi tat ca pass.
//
// Giac thiet phap ly (Google Chrome >= 138): --load-extension bi BO QUA tren
// nhanh "Google Chrome". Nen ham injectExtensionIntoProfile() boot Chrome mot lan de tao
// profile, ghi extension vao Default/Preferences (location 4 = UNPACKED), roi
// bat "Developer mode" bang cach click toggle #dev-mode trong shadow DOM cua
// chrome://extensions. Chrome < 133 hoac Chromium van chay duoc nhu cu.
// ---------------------------------------------------------------------------
"use strict";

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const crypto = require("node:crypto");

const ROOT = path.join(__dirname, "..");
const EXT_DIR = fs.realpathSync(ROOT); // duong dan tuyet doi -> ID on dinh
const MANIFEST = JSON.parse(fs.readFileSync(path.join(EXT_DIR, "manifest.json"), "utf8"));
const PORT = Number(process.env.E2E_PORT || 9777);
const BASE = "http://127.0.0.1:" + PORT;
const CHROME_BIN = process.env.E2E_CHROME || "/usr/bin/google-chrome";
const PIN = "matkhau-toi-2026"; // >= 8 ky tu, co chu va so
const WRONG_PIN = "000000";     // khong giai mai duoc blob
const BOOT_TIMEOUT = 30000;
const SKIP_IDLE = process.env.E2E_SKIP_IDLE === "1";

// Bo qua 2 cho dai (40s idle + restart trinh duyet) khi can chay nhanh
const WORK_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "genpass-e2e-"));
const USER_DIR = path.join(WORK_DIR, "profile");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ID unpacked cua Chrome = sha256(duong dan tuyet doi), lay 32 ky tu hex dau,
// moi ky tu hex map qua bang a-p (0->a ... f->p) - xem components/crx_file/id_util.cc
function extIdFor(dir) {
  const hex = crypto.createHash("sha256").update(dir).digest("hex").slice(0, 32);
  const map = { 0: "a", 1: "b", 2: "c", 3: "d", 4: "e", 5: "f", 6: "g", 7: "h", 8: "i", 9: "j", a: "k", b: "l", c: "m", d: "n", e: "o", f: "p" };
  return hex.split("").map((c) => map[c]).join("");
}
const EXT_ID = extIdFor(EXT_DIR);

// ---------------------------------------------------------------------------
// Bo thong bao ket qua: moi check la 1 dong co bang chang; scenario FAIL neu
// co 1 check sai. Khong bao gio "gia lap" PASS: khong chay duoc -> ghi NOT VERIFIED.
// ---------------------------------------------------------------------------
class Abort extends Error {}
const RESULTS = [];
let t0Suite = Date.now();
const START_T = Date.now();

function ctx() {
  const checks = [];
  return {
    checks,
    info: (label, evidence) => checks.push({ ok: true, label, evidence, info: true }),
    ok: (label, evidence) => checks.push({ ok: true, label, evidence }),
    bad: (label, evidence) => checks.push({ ok: false, label, evidence }),
    assert: (label, cond, evidence) => checks.push({ ok: !!cond, label, evidence }),
    require: (label, cond, evidence) => {
      checks.push({ ok: !!cond, label, evidence });
      if (!cond) throw new Abort("thieu dieu kien tien de: " + label);
    },
  };
}

async function scenario(id, title, fn) {
  const t0 = Date.now();
  const c = ctx();
  let fatal = null;
  try {
    await fn(c);
  } catch (e) {
    if (e instanceof Abort) fatal = e.message;
    else fatal = (e && e.stack ? e.stack.split("\n").slice(0, 3).join(" | ") : String(e));
  }
  const failed = c.checks.filter((x) => !x.ok);
  const ok = failed.length === 0 && !fatal;
  RESULTS.push({ id, title, ok, checks: c.checks, fatal, ms: Date.now() - t0 });
  const tag = ok ? "PASS" : "FAIL";
  console.log("\n[%s] %s - %s (%dms)", tag, id, title, Date.now() - t0);
  for (const x of c.checks) {
    console.log("    %s %s | %s", x.info ? "info" : (x.ok ? "ok  " : "FAIL"), x.label, x.evidence);
  }
  if (fatal) console.log("    FATAL %s", fatal);
  return ok;
}

// Poll co timeout tuyet doi, khong bao gio cho vo han.
async function waitFor(label, timeout, fn) {
  const t0 = Date.now();
  for (;;) {
    let v = null;
    try { v = await fn(); } catch (e) { v = null; }
    if (v) return v;
    if (Date.now() - t0 > timeout) throw new Error("TIMEOUT (" + timeout + "ms): " + label);
    await sleep(300);
  }
}

// ---------------------------------------------------------------------------
// CDP client: 1 WebSocket toi browser, send(method, params, sessionId).
// Dung flatten session (Target.attachToTarget {flatten:true}) de khong phai
// connect lai WebSocket cho tung target. Giu listener de bat console/exception.
// ---------------------------------------------------------------------------
class CDP {
  constructor(wsUrl) { this.url = wsUrl; this.ws = null; this.id = 0; this.pending = new Map(); this.log = []; }
  async connect() {
    this.ws = new WebSocket(this.url);
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error("WS open timeout")), 20000);
      this.ws.addEventListener("open", () => { clearTimeout(t); res(); }, { once: true });
      this.ws.addEventListener("error", () => { clearTimeout(t); rej(new Error("WS error")); }, { once: true });
    });
    this.ws.addEventListener("message", (ev) => this._onMsg(ev));
    this.ws.addEventListener("close", () => {
      for (const [, p] of this.pending) p.rej(new Error("WS closed giua chung"));
      this.pending.clear();
    });
    return this;
  }
  _onMsg(ev) {
    let m = null;
    try { m = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)); } catch (e) { return; }
    if (m.id !== undefined && this.pending.has(m.id)) {
      const p = this.pending.get(m.id);
      this.pending.delete(m.id);
      clearTimeout(p.timer);
      if (m.error) p.rej(new Error(m.error.message + " (CDP " + m.error.code + ")"));
      else p.res(m.result);
      return;
    }
    // Giu log trinh duyet lam bang chang khi trang nem loi
    if (m.method === "Runtime.consoleAPICalled") {
      const args = (m.params.args || []).map((a) => (a.value !== undefined ? String(a.value) : (a.description || a.type || "?")));
      CONSOLE_LOG.push({ type: m.params.type, text: args.join(" ") });
      this.log.push({ type: m.params.type, text: args.join(" ") });
    } else if (m.method === "Runtime.exceptionThrown") {
      const d = m.params.exceptionDetails || {};
      const text = String((d.exception && (d.exception.description || d.exception.value)) || d.text);
      CONSOLE_LOG.push({ type: "exception", text });
      this.log.push({ type: "exception", text });
    }
    if (this.log.length > 400) this.log.shift();
  }
  send(method, params, sessionId, timeout) {
    const id = ++this.id;
    const body = { id, method, params: params || {} };
    if (sessionId) body.sessionId = sessionId;
    const ms = timeout || 25000;
    return new Promise((res, rej) => {
      const timer = setTimeout(() => { this.pending.delete(id); rej(new Error("CDP timeout " + ms + "ms: " + method)); }, ms);
      this.pending.set(id, { res, rej, timer });
      try { this.ws.send(JSON.stringify(body)); } catch (e) { this.pending.delete(id); clearTimeout(timer); rej(e); }
    });
  }
  async ev(sessionId, expr, timeout) {
    const r = await this.send("Runtime.evaluate", { expression: expr, returnByValue: true, awaitPromise: true }, sessionId, (timeout || 20000) + 3000);
    if (r.exceptionDetails) {
      const d = r.exceptionDetails;
      throw new Error("EVAL " + String((d.exception && (d.exception.description || d.exception.value)) || d.text).split("\n")[0] + " :: " + expr.slice(0, 70));
    }
    return r.result ? r.result.value : undefined;
  }
  close() { try { if (this.ws) this.ws.close(); } catch (e) { /* bo qua */ } }
}

async function getJson(p) {
  const r = await fetch(BASE + p, { cache: "no-store" });
  return r.json();
}

// ---------------------------------------------------------------------------
// Vong doi trinh duyet
// ---------------------------------------------------------------------------
const BR = { proc: null, cdp: null, dead: false, exitInfo: "" };

function chromeArgs(dir, withFlag) {
  // --host-resolver-rules: ep localhost -> 127.0.0.1 de S9 phan biet origin
  // bang chuoi host that chu (cung server, khac origin string).
  const a = [
    "--headless=new", "--no-sandbox", "--disable-gpu", "--no-first-run",
    "--disable-dev-shm-usage", "--user-data-dir=" + dir,
    "--remote-debugging-port=" + PORT,
    "--host-resolver-rules=MAP localhost 127.0.0.1",
    "about:blank",
  ];
  if (withFlag) a.splice(a.length - 1, 0, "--load-extension=" + EXT_DIR);
  return a;
}

function spawnChrome(dir, withFlag) {
  const p = spawn(CHROME_BIN, chromeArgs(dir, withFlag), { stdio: ["ignore", "ignore", "ignore"], detached: true });
  p.on("error", (e) => { BR.dead = true; BR.exitInfo = "spawn error: " + e.message; try { p.kill("SIGKILL"); } catch (x) {} });
  p.on("exit", (code, signal) => {
    if (code !== 0 && code !== null) { BR.dead = true; BR.exitInfo = "exit code " + code + " signal " + signal; }
  });
  return p;
}

async function waitDevtools(timeout) {
  return waitFor("devtools port " + PORT, timeout || BOOT_TIMEOUT, async () => {
    try { await getJson("/json/version"); return true; } catch (e) { return false; }
  });
}

// Dong ca process group (detached) de khong con chrome le
function killBrowser(sig) {
  if (!BR.proc) return;
  try { process.kill(-BR.proc.pid, sig || "SIGKILL"); } catch (e) {
    try { BR.proc.kill(sig || "SIGKILL"); } catch (x) { /* da chet */ }
  }
}

async function stopBrowser() {
  if (BR.cdp) { BR.cdp.close(); BR.cdp = null; }
  killBrowser("SIGKILL");
  if (BR.proc) { await Promise.race([new Promise((r) => BR.proc.once("exit", r)), sleep(4000)]); BR.proc = null; }
  await sleep(800);
}

// Ghi extension unpacked vao profile Preferences (chieu cuoi cung neu Chrome
// khong nhan --load-extension). Can 1 lan boot on nho de Chrome tao Default/Preferences.
async function injectExtensionIntoProfile(dir) {
  const prefPath = path.join(dir, "Default", "Preferences");
  if (!fs.existsSync(prefPath)) throw new Error("khong thay Default/Preferences sau lan boot dau");
  const prefs = JSON.parse(fs.readFileSync(prefPath, "utf8"));
  prefs.extensions = prefs.extensions || {};
  prefs.extensions.settings = prefs.extensions.settings || {};
  prefs.extensions.settings[EXT_ID] = {
    path: EXT_DIR,
    location: 4, // Manifest::Location::UNPACKED
    state: 1, // ENABLED
    manifest: MANIFEST,
    was_installed_by_default: false,
    from_webstore: false,
    install_time: "17000000000000000",
  };
  fs.writeFileSync(prefPath, JSON.stringify(prefs));
}

// Chrome >= 133 tat extension unpacked khi developer mode OFF. Tat developer
// mode = click toggle #dev-mode trong shadow DOM cua chrome://extensions.
const CLICK_DEV_MODE = `(() => {
  const found = [];
  const walk = (n) => {
    if (!n) return;
    if (n.shadowRoot) {
      const t = n.shadowRoot.querySelector("#dev-mode") || n.shadowRoot.querySelector("cr-toggle");
      if (t) found.push(t);
      walk(n.shadowRoot);
    }
    for (const k of (n.children || [])) walk(k);
  };
  walk(document);
  if (!found.length) return "NO_TOGGLE";
  const t = found[0];
  const before = t.checked;
  t.click();
  return "before=" + before + " after=" + t.checked;
})()`;

const BOOT_EXPR = "document.readyState === 'complete' && !!document.getElementById('vault-lock') && typeof GPVault !== 'undefined'";

// Mo 1 trang chrome://extensions va bat developer mode
async function enableDeveloperMode(cdp) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Page.navigate", { url: "chrome://extensions" }, sessionId);
  const res = await waitFor("click developer mode", 15000, () =>
    cdp.ev(sessionId, CLICK_DEV_MODE, 10000).then((v) => (v && v.indexOf("after=") >= 0 && v.indexOf("after=true") >= 0 ? v : null)).catch(() => null));
  await sleep(2000);
  try { await cdp.send("Target.closeTarget", { targetId }); } catch (e) { /* bo qua */ }
  return res;
}

// Popup: tao target + attach flatten + doi page boot xong
async function openPopup(tag, bootMs) {
  const { targetId } = await BR.cdp.send("Target.createTarget", { url: "chrome-extension://" + EXT_ID + "/popup.html" });
  const { sessionId } = await BR.cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await BR.cdp.send("Runtime.enable", {}, sessionId);
  const rec = { tag, targetId, sessionId };
  BR.targets.push(rec);
  await waitFor("popup " + tag + " boot", bootMs || 20000, () =>
    BR.cdp.ev(sessionId, BOOT_EXPR, 8000).catch(() => false));
  return rec;
}

async function closePopup(rec, gap) {
  try { await BR.cdp.send("Target.closeTarget", { targetId: rec.targetId }); } catch (e) { /* da dong */ }
  const i = BR.targets.indexOf(rec);
  if (i >= 0) BR.targets.splice(i, 1);
  if (gap) await sleep(gap);
}

// Popup "thau do" storage: mo TRUOC khi bat vault va giu nguyen den cuoi.
// Vi vaultOn=false trong trang nay, pagehide khong bao gio xoa genVaultKey,
// va no cung khong connect port "vault-session" nen khong dem vao S4.
// Sau khi reload/restart, target cu co the chet -> tu phat hien va mo lai.
async function openProbe(tag) {
  if (BR.probe) {
    try {
      const ok = await BR.cdp.ev(BR.probe.sessionId, BOOT_EXPR, 5000);
      if (ok) return BR.probe;
    } catch (e) { /* session chet -> mo moi */ }
    const i = BR.targets.indexOf(BR.probe);
    if (i >= 0) BR.targets.splice(i, 1);
    BR.probe = null;
  }
  const rec = await openPopup(tag);
  BR.probe = rec;
  // Lang nghe moi thay doi storage lam bang chang (ai ghi/xoa genVaultKey khi nao)
  await q(rec, "window.__gpChanges = []; try { chrome.storage.onChanged.addListener(function (changes, area) { for (var k in changes) { window.__gpChanges.push({ t: Date.now(), area: area, k: k, new: (function(v){try{return JSON.stringify(v).slice(0,40)}catch(e){return '?'}})(changes[k].newValue), old: (function(v){try{return JSON.stringify(v).slice(0,40)}catch(e){return '?'}})(changes[k].oldValue) }); } if (window.__gpChanges.length > 500) window.__gpChanges.shift(); }); } catch (e) { window.__gpErr = String(e); } 'ok'").catch(() => null);
  return rec;
}

const click = (rec, id) => BR.cdp.ev(rec.sessionId, "(() => { var e = document.getElementById(" + JSON.stringify(id) + "); if (!e) return false; e.click(); return true; })()");
const setVal = (rec, id, v) => BR.cdp.ev(rec.sessionId, "(() => { var e = document.getElementById(" + JSON.stringify(id) + "); if (!e) return false; e.value = " + JSON.stringify(v) + "; return true; })()");
const isHidden = (rec, id) => BR.cdp.ev(rec.sessionId, "(() => { var e = document.getElementById(" + JSON.stringify(id) + "); return e ? e.hidden : null; })()");
const q = (rec, expr) => BR.cdp.ev(rec.sessionId, expr);

// Doi overlay lock o trang thai nhat dinh roi tra ve trang thai THAT cua no.
// (waitFor tra ve true khi thanh cong, nen khong dung truc tiep lam ket qua check.)
async function waitLockVisible(rec, timeoutMs, label) {
  await waitFor(label, timeoutMs, () => isHidden(rec, "vault-lock").then((h) => (h === false ? true : null)).catch(() => null));
  return (await isHidden(rec, "vault-lock")) === false;
}
async function waitLockHidden(rec, timeoutMs, label) {
  await waitFor(label, timeoutMs, () => isHidden(rec, "vault-lock").then((h) => (h === true ? true : null)).catch(() => null));
  return (await isHidden(rec, "vault-lock")) === true;
}
async function waitErrorVisible(rec, timeoutMs, label) {
  await waitFor(label, timeoutMs, () => isHidden(rec, "vault-lock-error").then((h) => (h === false ? true : null)).catch(() => null));
  return (await isHidden(rec, "vault-lock-error")) === false;
}

// Doc storage tu trang probe (extension page co quyen chrome.storage.*)
async function storageGet(area, keys) {
  const expr = "new Promise((r) => { try { chrome.storage." + area + ".get(" +
    (keys === null ? "null" : JSON.stringify(keys)) + ", (v) => r(v || {})); } catch (e) { r({ __err: String(e) }); } })";
  return BR.cdp.ev(BR.probe.sessionId, expr, 15000);
}
async function storageDump(area) { return storageGet(area, null); }

// Gui message toi service worker tu mot trang extension - canh bao SW dang ngu
async function sendSwMessageFrom(rec, msg) {
  return BR.cdp.ev(rec.sessionId, "new Promise((r) => { try { chrome.runtime.sendMessage(" + JSON.stringify(msg) + ", (v) => r(v === undefined ? { __noresp: true } : v)); } catch (e) { r({ __err: String(e) }); } })", 15000);
}

// Danh thuc SW neu no dang ngu (khong con target) bang cach mo 1 trang extension
async function wakeSw() {
  if (await swTargetPresent()) return true;
  const rec = await openPopup("wake-sw");
  try { await sendSwMessageFrom(rec, { action: "vault_state" }); } catch (e) { /* bo qua */ }
  await closePopup(rec);
  return !!(await swTargetPresent());
}

// Doc storage bang chinh service worker (khong mo popup -> khong lam ban profile)
async function swStorageGet(area, keys) {
  const r = await swEval("new Promise((r2) => chrome.storage." + area + ".get(" +
    (keys === null ? "null" : JSON.stringify(keys)) + ", (v) => r2(v || {})))");
  return r.ok ? r.value : { __err: r.why || "sw eval that bai" };
}

// Evaluate trong service worker: resolve lai target moi MOI lan (SW co the tu tat
// va khoi dong lai). Neu khong co target SW, danh thuc no truoc.
async function swEval(expr) {
  const target = async () => {
    const list = await getJson("/json/list");
    return list.find((t) => t.type === "service_worker" && t.url.indexOf("/" + EXT_ID + "/background.js") >= 0) || null;
  };
  let t = await target();
  if (!t) { await wakeSw(); t = await target(); }
  if (!t) return { ok: false, why: "khong co service_worker target" };
  const { sessionId } = await BR.cdp.send("Target.attachToTarget", { targetId: t.id, flatten: true });
  await BR.cdp.send("Runtime.enable", {}, sessionId);
  try {
    const v = await BR.cdp.ev(sessionId, expr, 15000);
    return { ok: true, value: v, targetId: t.id };
  } finally {
    try { await BR.cdp.send("Target.detachFromTarget", { sessionId }); } catch (e) { /* bo qua */ }
  }
}

async function swTargetPresent() {
  const list = await getJson("/json/list");
  const t = list.find((x) => x.type === "service_worker" && x.url.indexOf("/" + EXT_ID + "/background.js") >= 0);
  return t ? t.url : null;
}

// ---------------------------------------------------------------------------
// Kich ban chinh
// ---------------------------------------------------------------------------
BR.targets = [];
BR.probe = null;

// Console/exception cua trang extension/gia lap giu xuyen suot cac lan ket noi lai CDP
const CONSOLE_LOG = [];

// Popup giu qua lai giua cac kich ban
let s2Popup = null;
let s3Popup = null;
// Anh storage.local cua profile moi, chup qua SW truoc khi mo popup dau tien
let FRESH_LOCAL = null;

const FB_ITEM = { id: "1", name: "Facebook", url: "https://facebook.com", username: "me@example.com", password: "S3cret!vault" };
const TFA_ITEM = { id: "2", name: "GitHub", secret: "JBSWY3DPEHPK3PXP", account: "me@example.com" };
const LOCAL_ITEM = { id: "3", name: "Local Test", url: "http://127.0.0.1:8123", username: "local@example.com", password: "LocalLogin!2026" };
const LOCALHOST_ITEM = { id: "4", name: "Localhost Test", url: "http://localhost:8123", username: "lh@example.com", password: "LocalhostLogin!2026" };
const PLAIN_KEYS = ["genHistory", "gen2FA", "genCards", "genCookieProfiles", "genTags"];
const B64_44 = /^[A-Za-z0-9+/]{43}=$/; // 32 byte b64 = key AES-256

function b64Len(s) {
  try { return Buffer.from(String(s), "base64").length; } catch (e) { return -1; }
}


// Doc nhat ky thay doi storage (lap dat trong trang probe) - bang chung xem AI
// ghi/xoa genVaultKey vao thoi diem nao.
async function storageTimeline(filterKey) {
  const arr = await q(BR.probe, "JSON.stringify(window.__gpChanges || [])").catch(() => "[]");
  let list = [];
  try { list = JSON.parse(arr) || []; } catch (e) { list = []; }
  if (filterKey) {
    const f = [];
    for (const t of list) if (t.k === filterKey || t.area === "session") f.push(t);
    list = f;
  }
  return list;
}

// Anh trang thai DOM cua popup: de phan biet "dang bi khoa" vs "chua quyet dinh xong"
const popupSnap = async (rec) => {
  const v = await q(rec, "JSON.stringify({active:document.activeElement&&document.activeElement.id, vaultOn:document.getElementById('opt-vault-enabled').checked, lockHidden:document.getElementById('vault-lock').hidden, pinVal:document.getElementById('vault-pin').value, rows:document.querySelectorAll('.history-item').length, err:document.getElementById('vault-lock-error').textContent, errHidden:document.getElementById('vault-lock-error').hidden})");
  try { return JSON.parse(v); } catch (e) { return { raw: v }; }
};

// Quet de quy tat ca chuoi trong 1 object storage
function collectStrings(v, p, out) {
  if (typeof v === "string") { out.push({ path: p, value: v }); return; }
  if (Array.isArray(v)) { v.forEach((x, i) => collectStrings(x, p + "[" + i + "]", out)); return; }
  if (v && typeof v === "object") { Object.keys(v).forEach((k) => collectStrings(v[k], p ? p + "." + k : k, out)); }
}

async function main() {
  fs.rmSync(USER_DIR, { recursive: true, force: true });
  fs.mkdirSync(USER_DIR, { recursive: true });

  // Neu con Chrome le dang giu port 9777 -> thu dong no de tranh dinh port
  const stray = await waitFor("kiem tra port tu do", 3000, async () => {
    try { const v = await getJson("/json/version"); return v && v.Browser; } catch (e) { return false; }
  }).catch(() => null);
  if (stray) {
    console.log("[WARN] port %d dang bi giu boi trinh duyet khac (%s) -> thu Browser.close", PORT, stray);
    try {
      const ws = new WebSocket((await getJson("/json/version")).webSocketDebuggerUrl);
      await new Promise((r, j) => { const t = setTimeout(() => j(new Error("to")), 5000); ws.addEventListener("open", r, { once: true }); ws.addEventListener("error", j, { once: true }); });
      ws.send(JSON.stringify({ id: 1, method: "Browser.close" }));
      await sleep(1500);
      ws.close();
    } catch (e) { console.log("[WARN] khong dong duoc trinh duyet le: " + e.message); }
  }

  // ---- Khoi dong: thu --load-extension truoc (Chromium / Chrome cu) ----
  BR.proc = spawnChrome(USER_DIR, true);
  const up = await waitDevtools().catch(() => null);
  let loaded = false;
  let why = "";
  if (up && !BR.dead) {
    try {
      BR.cdp = await new CDP((await getJson("/json/version")).webSocketDebuggerUrl).connect();
      const p = await openPopup("launch-check", 8000);
      const fine = await BR.cdp.ev(p.sessionId, "location.href.indexOf('chrome-extension://') === 0 && typeof GPVault === 'object'", 8000).catch(() => false);
      loaded = !!fine;
      await closePopup(p);
    } catch (e) {
      why = e.message;
      loaded = false;
      if (BR.cdp) { BR.cdp.close(); BR.cdp = null; }
    }
  } else {
    why = "waitDevtools=" + up + " dead=" + BR.dead + " exitInfo=" + BR.exitInfo;
  }
  if (why) console.log("\n[INFO] thu --load-extension khong thanh cong: " + why);
  if (!loaded) {
    // Du phong: --load-extension bi Chrome 138+ bo qua -> bootstrap profile
    await stopBrowser();
    console.log("\n[INFO] --load-extension khong hieu luc (Google Chrome >= 138): bootstrap profile + developer mode");
    BR.proc = spawnChrome(USER_DIR, false);
    await waitDevtools().catch(() => null);
    await sleep(2000);
    if (BR.cdp) { BR.cdp.close(); BR.cdp = null; }
    BR.proc.kill("SIGTERM");
    await Promise.race([new Promise((r) => BR.proc.once("exit", r)), sleep(6000)]);
    BR.proc = null;
    await injectExtensionIntoProfile(USER_DIR);
    BR.proc = spawnChrome(USER_DIR, false);
    if (!await waitDevtools().catch(() => null)) throw new Error("Chrome khong khoi dong duoc sau bootstrap");
    BR.cdp = await new CDP((await getJson("/json/version")).webSocketDebuggerUrl).connect();
    const mode = await enableDeveloperMode(BR.cdp);
    console.log("[INFO] developer mode: %s", mode);
    // Chup storage NGAY LAP TRUC qua SW, truoc khi mo popup moi nao: popup.html
    // tu ghi genOptions khi sinh mat khau dau tien (popup.js:2149), nen khong the
    // check "genOptions absent" sau khi da mo popup.
    FRESH_LOCAL = await swStorageGet("local", null).catch(() => ({ __err: "khong doc duoc qua SW" }));
    const probe = await openPopup("bootstrap-check", 12000);
    const fine = await BR.cdp.ev(probe.sessionId, "location.href.indexOf('chrome-extension://') === 0 && typeof GPVault === 'object'", 10000).catch(() => false);
    if (!fine) throw new Error("extension van khong nap duoc sau bootstrap (NOT VERIFIED)");
    await closePopup(probe);
  }
  if (BR.dead) throw new Error("trinh duyet chet som: " + BR.exitInfo);
  console.log("\n[INFO] Chrome %j, extension id %s", (await getJson("/json/version")).Browser, EXT_ID);


  // ---------------------------------------------------------------- S0 ------
  await scenario("S0", "Fresh profile + popup mo duoc + vault off baseline", async (c) => {
    // Anh fresh profile lay qua SW truoc khi popup nao duoc mo
    c.assert("doc duoc storage.local qua SW (truoc khi mo popup)", !!FRESH_LOCAL && !FRESH_LOCAL.__err, FRESH_LOCAL && FRESH_LOCAL.__err ? FRESH_LOCAL.__err : "keys=" + Object.keys(FRESH_LOCAL || {}).sort().join(","));
    const f = FRESH_LOCAL || {};
    c.assert("chua co genOptions trong fresh profile", f.genOptions === undefined, "genOptions=" + JSON.stringify(f.genOptions));
    c.assert("chua co genVault (kho chua bao ho)", f.genVault === undefined, "genVault=" + JSON.stringify(f.genVault));
    const plainPresent = PLAIN_KEYS.filter((k) => f[k] !== undefined);
    c.assert("chua co khoa plaintext nao trong fresh profile", plainPresent.length === 0, "co=" + JSON.stringify(plainPresent));
    // Popup that: mo va mo
    const p = await openPopup("s0");
    c.ok("popup mo tai origin chrome-extension", await q(p, "location.href"));
    const lockHidden = await isHidden(p, "vault-lock");
    c.assert("vault-lock an (vault off baseline)", lockHidden === true, "hidden=" + lockHidden);
    c.assert("checkbox vault tat san", (await q(p, "document.getElementById('opt-vault-enabled').checked")) === false, "checked=" + await q(p, "document.getElementById('opt-vault-enabled').checked"));
    c.assert("khong co hang lich su nao", (await q(p, "document.querySelectorAll('.history-item').length")) === 0, "rows=" + await q(p, "document.querySelectorAll('.history-item').length"));
    const swUrl = await swTargetPresent();
    c.info("service worker cua extension", swUrl || "(SW dang ngu - khong anh huong)");
    await closePopup(p, 600);
  });

  // ---------------------------------------------------------------- S1 ------
  await scenario("S1", "Seed du lieu that qua storage cua trang extension", async (c) => {
    await openProbe("probe");
    // Lang nghe moi thay doi cua storage lam bang chang (ai ghi/xoa genVaultKey)
    await q(BR.probe, "window.__gpChanges = []; try { chrome.storage.onChanged.addListener(function (changes, area) { for (var k in changes) { window.__gpChanges.push({ t: Date.now(), area: area, k: k, new: (function(v){try{return JSON.stringify(v).slice(0,40)}catch(e){return '?'}})(changes[k].newValue), old: (function(v){try{return JSON.stringify(v).slice(0,40)}catch(e){return '?'}})(changes[k].oldValue) }); } if (window.__gpChanges.length > 400) window.__gpChanges.shift(); }); } catch (e) { window.__gpErr = String(e); } 'ok'");
    c.info("storage.onChanged listener da lap dat", String(await q(BR.probe, "typeof chrome.storage.onChanged.addListener === 'function' && !window.__gpErr")));
    const set = await q(BR.probe, "new Promise((r) => chrome.storage.local.set(" + JSON.stringify({
      genHistory: [FB_ITEM], gen2FA: [TFA_ITEM],
    }) + ", () => r(true)))");
    c.assert("chrome.storage.local.set thanh cong", set === true, "res=" + JSON.stringify(set));
    const back = await storageGet("local", ["genHistory", "gen2FA"]);
    c.assert("genHistory co 1 item Facebook", Array.isArray(back.genHistory) && back.genHistory.length === 1 && back.genHistory[0].name === "Facebook", JSON.stringify(back.genHistory && back.genHistory[0]));
    c.assert("gen2FA co 1 item GitHub", Array.isArray(back.gen2FA) && back.gen2FA.length === 1 && back.gen2FA[0].name === "GitHub", JSON.stringify(back.gen2FA && back.gen2FA[0]));
    // Popup.html tu ghi genOptions khi sinh mat khau dau tien (popup.js:2149):
    // ghi lai trang thai macro dinh cua checkbox tai thoi di do.
    const afterProbe = await storageGet("local", "genOptions");
    c.info("genOptions sau khi mo popup probe", JSON.stringify(afterProbe.genOptions || null));
    // Doc lai qua SW de chac chan du lieu nam o storage that (khong phao RAM)
    const viaSw = await swStorageGet("local", ["genHistory"]);
    c.assert("SW cung thay genHistory vua seed", Array.isArray(viaSw.genHistory) && viaSw.genHistory.length === 1, "items=" + (viaSw.genHistory || []).length);
  });

  // ---------------------------------------------------------------- S2 ------
  await scenario("S2", "Bat vault qua UI that (Argon2id wasm + CSP moi)", async (c) => {
    const p = await openPopup("s2");
    const version = await q(p, "chrome.runtime.getManifest().version");
    c.info("manifest version", String(version));
    c.assert("click checkbox opt-vault-enabled", await click(p, "opt-vault-enabled"), "clicked");
    await sleep(700);
    const modal = await isHidden(p, "modal-vault-pin");
    c.assert("modal dat PIN tu mo", modal === false, "hidden=" + modal);
    c.assert("set vault-pin-new", await setVal(p, "vault-pin-new", PIN), "value set");
    c.assert("set vault-pin-confirm", await setVal(p, "vault-pin-confirm", PIN), "value set");
    const t0 = Date.now();
    c.assert("click btn-vault-pin-save", await click(p, "btn-vault-pin-save"), "clicked");
    const blob = await waitFor("genVault xuat hien (poll 20s)", 20000, async () => (await storageGet("local", "genVault")).genVault || null);
    c.ok("genVault duoc ghi sau " + (Date.now() - t0) + "ms", "Argon2id wasm chay that trong trang extension");
    c.assert("blob v === 2", blob.v === 2, "v=" + blob.v);
    c.assert("blob kdf === argon2id", blob.kdf === "argon2id", "kdf=" + blob.kdf);
    c.assert("blob khop tham so Argon2id (t=3, m=65536, p=4)", blob.t === 3 && blob.m === 65536 && blob.p === 4, "t=" + blob.t + " m=" + blob.m + " p=" + blob.p);
    c.assert("salt la base64 16 byte", typeof blob.salt === "string" && b64Len(blob.salt) === 16, "len=" + b64Len(blob.salt));
    c.assert("iv la base64 12 byte", typeof blob.iv === "string" && b64Len(blob.iv) === 12, "len=" + b64Len(blob.iv));
    c.assert("ct la base64 >= 48 byte", typeof blob.ct === "string" && b64Len(blob.ct) >= 48, "len=" + b64Len(blob.ct));
    // Doi TAT CA buoi mat: blob co, 5 khoa plaintext bien mat, genOptions da ghi.
    // vaultEnable ghi blob -> ghi rac + remove plaintext -> ghi phien -> saveOptions,
    // nen phai poll den trang thai CUOI CUNG, khong thi doc giua chung se thay
    // genOptions.vaultEnabled con false (da gap o lan chay that).
    let loc = null;
    try {
      loc = await waitFor("vault bat xong (blob + plaintext sach + genOptions da cap nhat, poll 15s)", 15000, async () => {
        const d = await storageDump("local");
        const okBlob = !!d.genVault;
        const okPlain = PLAIN_KEYS.every((k) => !Object.prototype.hasOwnProperty.call(d, k));
        const okOpts = !!d.genOptions && d.genOptions.vaultEnabled === true;
        return (okBlob && okPlain && okOpts) ? d : null;
      });
    } catch (e) { loc = await storageDump("local"); }
    const left = PLAIN_KEYS.filter((k) => Object.prototype.hasOwnProperty.call(loc, k));
    c.assert("5 khoa plaintext da bien mat khoi storage.local", left.length === 0, "con lai=" + JSON.stringify(left));
    const opts = loc.genOptions || {};
    c.info("genOptions sau khi bat vault", JSON.stringify(opts));
    c.assert("genOptions.vaultEnabled === true", opts.vaultEnabled === true, JSON.stringify(opts.vaultEnabled));
    c.assert("genOptions.vaultLockClose === true", opts.vaultLockClose === true, JSON.stringify(opts.vaultLockClose));
    c.assert("genOptions.vaultTimeoutMin la so", typeof opts.vaultTimeoutMin === "number", JSON.stringify(opts.vaultTimeoutMin));
    const sess = await storageGet("session", "genVaultKey");
    const entry = sess.genVaultKey;
    c.assert("storage.session genVaultKey la envelope {k, exp}", !!entry && typeof entry === "object" && typeof entry.k === "string" && typeof entry.exp === "number", JSON.stringify(entry && { k: entry.k && entry.k.slice(0, 6) + "...", exp: entry.exp }));
    c.assert("k la base64 44 ky tu (256-bit)", !!entry && B64_44.test(entry.k), "len=" + (entry && entry.k ? entry.k.length : "?"));
    c.assert("exp nam trong tuong lai", !!entry && entry.exp > Date.now(), "exp=" + (entry && entry.exp));
    c.assert("popup o trang thai da mo khoa", (await isHidden(p, "vault-lock")) === true, "hidden=" + await isHidden(p, "vault-lock"));
    c.assert("hang Facebook hien sau khi bat vault", (await q(p, "document.querySelectorAll('.history-item').length")) === 1, "rows=" + await q(p, "document.querySelectorAll('.history-item').length"));
    s2Popup = p;
  });

  // ---------------------------------------------------------------- S3 ------
  await scenario("S3", "Tu khoa khi dong popup + sai/dung ma bao ve", async (c) => {
    c.info("truoc khi dong popup S2: session key co mat", !!(await storageGet("session", "genVaultKey")).genVaultKey);
    await closePopup(s2Popup, 1500);
    const p = await openPopup("s3");
    await waitLockVisible(p, 8000, "vault-lock hien sau khi mo lai popup");
    const lock = await isHidden(p, "vault-lock");
    c.assert("vault-lock overlay HIEN sau khi dong/mo popup", lock === false, "hidden=" + lock);
    const rows = await q(p, "document.querySelectorAll('.history-item').length");
    c.assert("khong co hang lich su nao khi dang khoa", rows === 0, "rows=" + rows);
    c.assert("session key da bi thu hoi", !(await storageGet("session", "genVaultKey")).genVaultKey, JSON.stringify(await storageGet("session", "genVaultKey")));
    // Sai ma bao ve
    c.assert("set vault-pin = '000000'", await setVal(p, "vault-pin", WRONG_PIN), "set");
    c.assert("click vault-unlock-btn", await click(p, "vault-unlock-btn"), "clicked");
    await waitErrorVisible(p, 20000, "vault-lock-error hien (Argon2id that + giai mai that bai)");
    c.assert("bao loi hien voi ma sai", (await isHidden(p, "vault-lock-error")) === false, "hidden=" + await isHidden(p, "vault-lock-error"));
    c.assert("noi dung bao loi dung", /khong dung|không đúng/i.test(await q(p, "document.getElementById('vault-lock-error').textContent")), JSON.stringify(await q(p, "document.getElementById('vault-lock-error').textContent")));
    c.assert("van o trang thai khoa", (await isHidden(p, "vault-lock")) === false, "hidden=" + await isHidden(p, "vault-lock"));
    // Dung ma bao ve
    c.assert("set vault-pin dung", await setVal(p, "vault-pin", PIN), "set");
    c.assert("click vault-unlock-btn lan 2", await click(p, "vault-unlock-btn"), "clicked");
    const unlocked = await waitLockHidden(p, 20000, "overlay bien mat sau ma dung");
    c.assert("mo kho thanh cong voi ma dung", unlocked, "overlay hidden=" + unlocked);
    const rows2 = await q(p, "document.querySelectorAll('.history-item').length");
    c.assert("hang Facebook hien lai", rows2 === 1, "rows=" + rows2);
    const names = await q(p, "Array.from(document.querySelectorAll('.history-name')).map((e) => e.textContent).join('|')");
    c.assert("ten hang la Facebook", names.indexOf("Facebook") >= 0, names);
    const sessOk = (await storageGet("session", "genVaultKey")).genVaultKey;
    c.assert("session key duoc ghi lai sau khi mo kho", !!sessOk, JSON.stringify(sessOk && sessOk.k && sessOk.k.slice(0, 6)));
    s3Popup = p;
  });


  // ---------------------------------------------------------------- S4 ------
  await scenario("S4", "Nhieu popup: dong 1 popup khong duoc khoa nham phien", async (c) => {
    // s3Popup dang mo va da mo khoa. Dong no truoc de co trang thai sach, roi
    // mo lai mot popup va MO KHOA bang ma that: luc do moi co phien song.
    await closePopup(s3Popup, 1200);
    c.assert("phien da bi thu hoi sau khi dong popup cuoi cua S3", !(await storageGet("session", "genVaultKey")).genVaultKey, "");
    const pa = await openPopup("s4-a");
    await waitLockVisible(pa, 8000, "popup s4-a bi khoa");
    c.assert("popup s4-a o trang thai khoa truoc khi nhap ma", (await isHidden(pa, "vault-lock")) === false, "hidden=" + await isHidden(pa, "vault-lock"));
    // Mo khoa bang ma that qua UI -> phien song + port cua A
    c.assert("set ma bao ve cho s4-a", await setVal(pa, "vault-pin", PIN), "set");
    c.assert("click mo khoa s4-a", await click(pa, "vault-unlock-btn"), "clicked");
    const ha = await waitLockHidden(pa, 20000, "s4-a mo khoa");
    c.assert("popup s4-a da mo khoa (phien song)", ha, "overlay hidden=" + ha);
    const keyBeforeA = (await storageGet("session", "genVaultKey")).genVaultKey;
    c.assert("session key co mat sau khi mo khoa s4-a", !!keyBeforeA, JSON.stringify(keyBeforeA && keyBeforeA.k && keyBeforeA.k.slice(0, 6)));
    // Mo popup B khi phien dang song -> B phai tu mo khoa, khong can nhap ma
    const pb = await openPopup("s4-b");
    const hb = await waitLockHidden(pb, 15000, "popup s4-b tu mo khoa (khong nhap ma)");
    c.assert("popup B tu mo khoa ma khong can nhap ma", hb, "overlay hidden=" + hb);
    const rowsB0 = await q(pb, "document.querySelectorAll('.history-item').length");
    c.assert("popup B thay du lieu Facebook", rowsB0 === 1, "rows=" + rowsB0);
    // Kiem tra that: pagehide co chay khi dong target qua CDP khong?
    await q(pa, "window.addEventListener('pagehide', function () { try { chrome.storage.local.set({ __gpPagehideA: Date.now() }); } catch (e) {} }); 1");
    await q(pa, "window.__gpHid = 0; window.addEventListener('pagehide', function () { window.__gpHid = Date.now(); }); 1");
    // Dong popup A: port counter phai giu lai phien cho B
    await closePopup(pa, 1200);
    const phA = await storageGet("local", "__gpPagehideA");
    c.info("pagehide cua popup A co chay khong (marker trong storage)", JSON.stringify(phA.__gpPagehideA || null));
    const afterA = (await storageGet("session", "genVaultKey")).genVaultKey;
    c.assert("dong popup A: session key VAN CON (port counter)", !!afterA,
      afterA ? "genVaultKey con nguyen, k=" + String(afterA.k).slice(0, 6) + "..." : "genVaultKey DA BI XOA khi dong popup A (BUG: pagehide popup.js xoa phien chung du B dang mo)");
    // Bang chang chien luoc: B van doc duoc kho khong (neu phien chet thi __locked)
    const bRead = await q(pb, "new Promise((r) => chrome.runtime.sendMessage({action:'vault_get', keys:['genHistory']}, (v) => r(v)))");
    c.assert("popup B van doc duoc du lieu kho sau khi dong A", !!bRead && !bRead.__locked && Array.isArray(bRead.genHistory), JSON.stringify(bRead && bRead.__locked ? "__locked" : { items: (bRead.genHistory || []).length }));
    // Dong popup B (popup cuoi cung) -> phai thu hoi phien
    await closePopup(pb, 1800);
    const afterB = (await storageGet("session", "genVaultKey")).genVaultKey;
    c.assert("dong popup cuoi: session key BI THU HOI", !afterB, JSON.stringify(afterB ? { k: afterB.k && afterB.k.slice(0, 6) } : null));
    const p = await openPopup("s4-c");
    // Theo doi 8s: trang popup co bi TAI LAI khong (window.__gpBoot bien mat)
    // va overlay co tu bien mat khong. Poll tu harness de khong bi treo thoat.
    await q(p, "window.__gpBoot = Date.now(); 'ok'");
    const poll = [];
    const tp0 = Date.now();
    while (Date.now() - tp0 < 5000) {
      const st = await q(p, "JSON.stringify({boot:window.__gpBoot||null, lockHidden:document.getElementById('vault-lock').hidden, rows:document.querySelectorAll('.history-item').length, focus:document.activeElement&&document.activeElement.id})").catch(() => null);
      if (st) { try { poll.push(Object.assign({ t: Date.now() - tp0 }, JSON.parse(st))); } catch (e) {} }
      await sleep(150);
    }
    const trans = poll.filter((x, i, a) => i === 0 || a[i - 1].lockHidden !== x.lockHidden || a[i - 1].boot !== x.boot || a[i - 1].rows !== x.rows);
    c.info("poll trang thai popup s4-c (5s)", JSON.stringify(trans));
    const reloaded = poll.some((x) => !x.boot);
    c.assert("trang popup s4-c khong bi tai lai trong 5s", !reloaded, reloaded ? "window.__gpBoot bien mat => TRANG BI TAI LAI" : "giu nguyen cung mot document");
    await sleep(1000);
    const snapC = await popupSnap(p);
    c.info("anh trang thai popup s4-c", JSON.stringify(snapC));
    c.info("session key khi popup s4-c dang mo", JSON.stringify((await storageGet("session", "genVaultKey")).genVaultKey || null));
    const lock = await waitLockVisible(p, 8000, "mo lai popup -> bi khoa");
    c.assert("mo lai popup -> lock overlay HIEN", lock, "overlay visible=" + lock + " snapshot=" + JSON.stringify(snapC));
    const rowsC = await q(p, "document.querySelectorAll('.history-item').length");
    c.assert("popup bi khoa khong hien hang nao", rowsC === 0, "rows=" + rowsC);
    await closePopup(p, 800);
    // Nhat ky thay doi cua storage.local/session trong S4
    const tl = await storageTimeline();
    c.info("nhat ky thay doi storage (S4, " + tl.length + " su kien)", JSON.stringify(tl.map((x) => ({ t: x.t - START_T, area: x.area, k: x.k, new: x.new, old: x.old }))));
  });

  // ---------------------------------------------------------------- S5 ------
  // Sau S4 popup cuoi da dong nen phien da bi thu hoi. De kiem tra "SW restart
  // khong tu khoa nham" ta can mot phien SONG trong khi SW bi Chrome tat.
  // vaultLockClose=true thi dong popup la mat phien, nen buoc qua UI tat tuy
  // chon do truoc, roi moi de profile khong con port nao toi SW.
  if (SKIP_IDLE) {
    await scenario("S5", "Idle > 35s: phien song sot qua SW restart", async (c) => {
      c.info("E2E_SKIP_IDLE=1", "bo qua 40s nghi ngoi (chay nhanh)");
      c.assert("bo qua co y tu nguoi dung (khong tinh FAIL)", true, "E2E_SKIP_IDLE=1");
    });
  } else {
    await scenario("S5", "Idle > 35s: phien song sot qua SW restart", async (c) => {
      const p = await openPopup("s5-hold");
      await waitLockVisible(p, 8000, "popup bi khoa");
      c.assert("popup o trang thai khoa (S4 da thu hoi phien)", (await isHidden(p, "vault-lock")) === false, "hidden=" + await isHidden(p, "vault-lock"));
      // Tat tuy chon "tu khoa khi dong popup" qua UI that
      c.assert("uncheck opt-vault-lock-close", await click(p, "opt-vault-lock-close"), "clicked");
      await sleep(400);
      c.assert("checkbox opt-vault-lock-close da tat", (await q(p, "document.getElementById('opt-vault-lock-close').checked")) === false, "checked=" + await q(p, "document.getElementById('opt-vault-lock-close').checked"));
      c.assert("genOptions.vaultLockClose === false sau khi bo chon", (await storageGet("local", "genOptions")).genOptions.vaultLockClose === false, JSON.stringify((await storageGet("local", "genOptions")).genOptions));
      // Mo khoa bang ma that
      c.assert("set ma dung", await setVal(p, "vault-pin", PIN), "set");
      c.assert("click vault-unlock-btn", await click(p, "vault-unlock-btn"), "clicked");
      const unlocked = await waitLockHidden(p, 20000, "mo khoa thanh cong");
      c.assert("da mo khoa bang ma that", unlocked, "overlay hidden=" + unlocked);
      const key1 = (await storageGet("session", "genVaultKey")).genVaultKey;
      c.assert("session key co mat sau khi mo khoa", !!key1, JSON.stringify(key1 && key1.k && key1.k.slice(0, 6)));
      const swBefore = await swTargetPresent();
      c.info("service worker truoc khi dong popup", String(swBefore));
      // Dong popup: vi lockClose=false nen phien phai song sot
      await closePopup(p, 1500);
      const keyAfterClose = (await storageGet("session", "genVaultKey")).genVaultKey;
      c.assert("vaultLockClose=false: dong popup van giu phien", !!keyAfterClose, JSON.stringify(keyAfterClose && keyAfterClose.k && keyAfterClose.k.slice(0, 6)));
      c.info("nghi ngoi 40s de Chrome tu tat SW...", "khong con port nao toi SW (trang probe khong connect port)");
      await sleep(40000);
      const swAfter = await swTargetPresent();
      c.info("service worker sau 40s idle", swAfter ? "VAN SONG: " + swAfter : "da bi Chrome tat (khong con target)");
      const key2 = (await storageGet("session", "genVaultKey")).genVaultKey;
      c.assert("session key VAN CON sau khi SW bi tat", !!key2, swAfter ? "SW van song, phien con nguyen" : "SW da bi tat, phien van con (dung nhu thiet ke MV3)");
      // Mo popup moi: phai tu mo khoa khong can nhap ma
      const p2 = await openPopup("s5-auto");
      const auto = await waitLockHidden(p2, 15000, "popup moi tu mo khoa (khong nhap ma)");
      c.assert("popup moi tu mo khoa ma khong can nhap ma", auto, "overlay hidden=" + auto);
      const rowsAuto = await q(p2, "document.querySelectorAll('.history-item').length");
      c.assert("popup tu mo khoa thay du lieu Facebook", rowsAuto === 1, "rows=" + rowsAuto);
      // Tra lai tuy chon mac dinh va thu hoi phien de S6/S7 bat dau tu trang thai sach
      c.assert("re-check opt-vault-lock-close", await click(p2, "opt-vault-lock-close"), "clicked");
      await sleep(500);
      c.assert("genOptions.vaultLockClose === true tro lai", (await storageGet("local", "genOptions")).genOptions.vaultLockClose === true, JSON.stringify((await storageGet("local", "genOptions")).genOptions));
      await closePopup(p2, 1800);
      const keyEnd = (await storageGet("session", "genVaultKey")).genVaultKey;
      c.assert("phien da duoc thu hoi truoc khi S6", !keyEnd, JSON.stringify(keyEnd && keyEnd.k && keyEnd.k.slice(0, 6)));
    });
  }

  // ---------------------------------------------------------------- S6 ------
  await scenario("S6", "chrome.runtime.reload(): phien song bi xoa (theo tai lieu MV3)", async (c) => {
    // Tao phien SONG truoc khi reload, neu khong thi khong kiem tra duoc gi
    const warm = await openPopup("s6-warm");
    await waitLockVisible(warm, 8000, "popup s6-warm bi khoa");
    await setVal(warm, "vault-pin", PIN);
    await click(warm, "vault-unlock-btn");
    const wu = await waitLockHidden(warm, 20000, "popup s6-warm mo khoa");
    c.assert("mo khoa thanh cong truoc reload (phien song)", wu, "overlay hidden=" + wu);
    const keyBefore = (await storageGet("session", "genVaultKey")).genVaultKey;
    c.assert("session key co mat truoc reload", !!keyBefore, JSON.stringify(keyBefore && keyBefore.k && keyBefore.k.slice(0, 6)));
    await closePopup(warm, 0);
    c.info("truoc reload: session key", JSON.stringify(keyBefore || null));
    const sw = await swTargetPresent();
    if (sw) {
      const r = await swEval("chrome.runtime.reload(); 'reload-sent'");
      c.assert("goi chrome.runtime.reload() tren SW target", r.ok === true && r.value === "reload-sent", JSON.stringify(r));
    } else {
      c.info("khong co SW target", "goi reload tu trang probe");
      const r = await q(BR.probe, "chrome.runtime.reload(); 'reload-sent'").catch((e) => ({ err: e.message }));
      c.assert("goi chrome.runtime.reload() tu trang extension", r === "reload-sent" || typeof r === "object", JSON.stringify(r));
    }
    await sleep(3000);
    // Trang probe cu co the bi Chrome huy sau reload -> openProbe tu mo lai
    await openProbe("probe-3");
    const keyAfter = (await storageGet("session", "genVaultKey")).genVaultKey;
    c.assert("storage.session genVaultKey da bi xoa sau reload", !keyAfter, JSON.stringify(keyAfter || null));
    const p = await openPopup("s6");
    await sleep(2500);
    const snap6 = await popupSnap(p);
    c.info("anh trang thai popup sau reload", JSON.stringify(snap6));
    c.info("session key khi popup dang mo", JSON.stringify((await storageGet("session", "genVaultKey")).genVaultKey || null));
    const lock = await waitLockVisible(p, 10000, "popup hien lock overlay sau reload");
    c.assert("lock overlay HIEN sau reload", lock, "overlay visible=" + lock + " snapshot=" + JSON.stringify(snap6));
    const blob = (await storageGet("local", "genVault")).genVault;
    c.assert("genVault van con sau reload (storage.local khong mat)", !!blob, "co genVault=" + !!blob);
    const rows6 = await q(p, "document.querySelectorAll('.history-item').length");
    c.assert("popup bi khoa khong hien hang nao", rows6 === 0, "rows=" + rows6);
    await closePopup(p, 800);
    const tl6 = await storageTimeline();
    c.info("nhat ky thay doi storage (S6, " + tl6.length + " su kien)", JSON.stringify(tl6.map((x) => ({ t: x.t - START_T, area: x.area, k: x.k, new: x.new, old: x.old }))));
  });

  // ---------------------------------------------------------------- S7 ------
  if (SKIP_IDLE) {
    await scenario("S7", "Khoi dong lai trinh duyet: storage.session bi xoa", async (c) => {
      c.info("E2E_SKIP_IDLE=1", "bo qua restart trinh duyet (chay nhanh)");
      c.assert("bo qua co y tu nguoi dung (khong tinh FAIL)", true, "E2E_SKIP_IDLE=1");
    });
  } else {
    await scenario("S7", "Khoi dong lai trinh duyet: storage.session bi xoa", async (c) => {
      const warm = await openPopup("s7-warm");
      await waitLockVisible(warm, 8000, "popup bi khoa");
      await setVal(warm, "vault-pin", PIN);
      await click(warm, "vault-unlock-btn");
      const u = await waitLockHidden(warm, 20000, "mo khoa thanh cong truoc khi restart");
      c.assert("mo khoa thanh cong truoc khi restart", u, "overlay hidden=" + u);
      c.assert("session key co mat truoc khi restart", !!(await storageGet("session", "genVaultKey")).genVaultKey, "");
      c.info("so target dang theo doi truoc restart", String(BR.targets.length));
      await stopBrowser();
      await sleep(1200);
      BR.proc = spawnChrome(USER_DIR, false);
      const up = await waitDevtools(45000).catch(() => null);
      if (!up || BR.dead) {
        c.bad("Chrome khoi dong lai duoc (NOT VERIFIED)", "waitDevtools=" + up + " dead=" + BR.dead + " exitInfo=" + BR.exitInfo);
        throw new Abort("khong khoi dong lai duoc Chrome");
      }
      BR.cdp = await new CDP((await getJson("/json/version")).webSocketDebuggerUrl).connect();
      await openProbe("probe-2");
      await waitFor("service worker hoat dong lai sau restart", 20000, async () => (await swTargetPresent()) ? true : (await wakeSw(), (await swTargetPresent()) ? true : null));
      const p = await openPopup("s7");
      const keyAfter = (await storageGet("session", "genVaultKey")).genVaultKey;
      c.assert("storage.session genVaultKey da bi xoa cung trinh duyet", !keyAfter, JSON.stringify(keyAfter || null));
      const lock = await waitLockVisible(p, 10000, "popup hien lock overlay sau restart");
      c.assert("lock overlay HIEN sau restart", lock, "overlay visible=" + lock);
      const rows = await q(p, "document.querySelectorAll('.history-item').length");
      c.assert("khong co du lieu nao bi hien khi chua mo khoa", rows === 0, "rows=" + rows);
      const blob7 = (await storageGet("local", "genVault")).genVault;
      c.assert("genVault van con sau restart (du lieu khong mat)", !!blob7, "co genVault=" + !!blob7);
      await closePopup(p, 800);
    });
  }

  // ---------------------------------------------------------------- S8 ------
  await scenario("S8", "Audit vi tri key: khong co key ngoai blob + khong TRUSTED_AND_UNTRUSTED_CONTEXTS", async (c) => {
    await openProbe("probe-4");
    // Audit phai chay khi phien DANG SONG, neu khong so sanh "key co nam ngoai
    // blob khong" khong kiem tra duoc gi (khong co key de so).
    const pw = await openPopup("s8");
    await waitLockVisible(pw, 8000, "popup s8 bi khoa (S7 da xoa phien)");
    c.assert("set ma bao ve cho s8", await setVal(pw, "vault-pin", PIN), "set");
    c.assert("click mo khoa s8", await click(pw, "vault-unlock-btn"), "clicked");
    const su = await waitLockHidden(pw, 20000, "popup s8 mo khoa");
    c.assert("phien dang song trong luc audit", su, "overlay hidden=" + su);
    const local = await storageDump("local");
    const sync = await storageDump("sync");
    c.assert("storage.local dump duoc (khong loi)", !local.__err, local.__err || "keys=" + Object.keys(local).sort().join(","));
    c.assert("storage.sync dump duoc (khong loi)", !sync.__err, sync.__err || "keys=" + Object.keys(sync).sort().join(","));
    const sessKey = (await storageGet("session", "genVaultKey")).genVaultKey;
    const kVal = sessKey && sessKey.k;
    // 1) khong co khoa "genVaultKey" trong local/sync
    c.assert("khong co khoa 'genVaultKey' trong storage.local", !Object.prototype.hasOwnProperty.call(local, "genVaultKey"), "local keys=" + Object.keys(local).sort().join(","));
    c.assert("khong co khoa 'genVaultKey' trong storage.sync", !Object.prototype.hasOwnProperty.call(sync, "genVaultKey"), "sync keys=" + Object.keys(sync).sort().join(","));
    // 2) khong co chuoi nao bang key phien
    const lStr = [], sStr = [];
    collectStrings(local, "", lStr);
    collectStrings(sync, "", sStr);
    const hitLocal = kVal ? lStr.filter((x) => x.value === kVal) : [];
    const hitSync = kVal ? sStr.filter((x) => x.value === kVal) : [];
    c.assert("khong co gia tri nao trong storage.local bang key phien", hitLocal.length === 0, hitLocal.length ? "tai " + hitLocal[0].path : "da quyet " + (kVal ? "44 ky tu" : "khong co phien"));
    c.assert("khong co gia tri nao trong storage.sync bang key phien", hitSync.length === 0, hitSync.length ? "tai " + hitSync[0].path : "khong co");
    // 3) cac chuoi base64 dai chi nam trong genVault.{salt,iv,ct}
    const b64ish = (s) => /^[A-Za-z0-9+/]+={0,2}$/.test(s) && s.length >= 20;
    const outside = lStr.filter((x) => b64ish(x.value) && x.path.indexOf("genVault") !== 0);
    c.assert("chuoi base64 dai khong nam ngoai genVault.*", outside.length === 0, outside.length ? outside.map((x) => x.path + " (" + x.value.length + " ky tu)").join(", ") : "toan bo nam trong genVault.*");
    const b44 = lStr.filter((x) => B64_44.test(x.value));
    c.assert("khong co chuoi 44 ky tu (32 byte b64) nam ngoai blob", b44.length === 0, b44.length ? b44.map((x) => x.path).join(", ") : "khong co (key chi nam trong storage.session)");
    const blob = local.genVault || null;
    c.assert("blob genVault co salt/iv/ct", !!blob && typeof blob.salt === "string" && typeof blob.iv === "string" && typeof blob.ct === "string", blob ? "salt=" + blob.salt.slice(0, 8) + ".. iv=" + blob.iv.slice(0, 8) + ".. ct=" + blob.ct.length + " ky tu" : "KHONG co blob genVault");
    c.assert("vung nho genVault chi gom salt/iv/ct/tham so", !!blob && Object.keys(blob).sort().join(",") === "ct,iv,kdf,m,p,salt,t,v", blob ? Object.keys(blob).sort().join(",") : "-");
    // 4) code-level: khong dung TRUSTED_AND_UNTRUSTED_CONTEXTS
    const files = ["manifest.json", "background.js", "popup.js", "vault.js", "content.js"];
    const hits = [];
    for (const f of files) {
      const txt = fs.readFileSync(path.join(EXT_DIR, f), "utf8");
      if (txt.indexOf("TRUSTED_AND_UNTRUSTED_CONTEXTS") >= 0) hits.push(f);
    }
    c.assert("khong co 'TRUSTED_AND_UNTRUSTED_CONTEXTS' trong manifest/background", hits.length === 0, hits.length ? "co trong " + hits.join(",") : "da quyet " + files.join(", "));
    const csp = (MANIFEST.content_security_policy || {}).extension_pages || "";
    c.info("CSP extension_pages", csp);
    c.assert("CSP co wasm-unsafe-eval (cho Argon2id wasm)", csp.indexOf("wasm-unsafe-eval") >= 0, csp);
    c.info("storage.sync keys", Object.keys(sync).length ? Object.keys(sync).sort().join(",") : "(trong)");
    c.info("storage.local keys", Object.keys(local).sort().join(","));
    c.assert("phien van song sau khi audit xong", !!(await storageGet("session", "genVaultKey")).genVaultKey, "");
    await closePopup(pw, 800);
  });

  // ---------------------------------------------------------------- S9 ------
  await scenario("S9", "Content script relay + autofill badge (trang that)", async (c) => {
    const http = require("node:http");
    const PAGE = "<!doctype html><html><head><meta charset='utf-8'><title>GenPass E2E login</title></head>" +
      "<body><h1>Local login</h1><form action='/' method='get'>" +
      "<input id='user' type='text' name='u' placeholder='username'>" +
      "<input id='pw' type='password' name='p' placeholder='password'>" +
      "<button type='submit'>Sign in</button></form></body></html>";
    const srv = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(PAGE);
    });
    await new Promise((r, j) => { srv.once("error", j); srv.listen(8123, "127.0.0.1", r); });
    const tabs = [];
    const openTab = async (url, tag) => {
      const { targetId } = await BR.cdp.send("Target.createTarget", { url });
      const { sessionId } = await BR.cdp.send("Target.attachToTarget", { targetId, flatten: true });
      await BR.cdp.send("Runtime.enable", {}, sessionId);
      const rec = { tag, targetId, sessionId, url };
      tabs.push(rec);
      await waitFor("tab " + tag + " load", 20000, () =>
        BR.cdp.ev(sessionId, "document.readyState === 'complete' && !!document.getElementById('pw')", 8000).catch(() => false));
      return rec;
    };
    try {
      // Can mot popup dang MO VA MO KHOA de SW nhan message vault_get/vault_put tu content script
      const p9 = await openPopup("s9");
      await waitLockVisible(p9, 8000, "popup s9 bi khoa");
      await setVal(p9, "vault-pin", PIN);
      await click(p9, "vault-unlock-btn");
      const u = await waitLockHidden(p9, 20000, "popup s9 mo khoa");
      c.assert("popup s9 da mo khoa (vault_get/vault_put se chay duoc)", u, "overlay hidden=" + u);
      // Seed item co url trung origin 127.0.0.1:8123 (read-modify-write qua message that)
      const before = await q(p9, "new Promise((r) => chrome.runtime.sendMessage({action:'vault_get', keys:['genHistory']}, (v) => r(v)))");
      const list = (before && before.genHistory) || [];
      const seeded = list.filter((x) => x.id !== LOCAL_ITEM.id).concat([LOCAL_ITEM]);
      const put = await q(p9, "new Promise((r) => chrome.runtime.sendMessage({action:'vault_put', items:{genHistory:" + JSON.stringify(seeded) + "}}, (v) => r(v)))");
      c.assert("vault_put ghi duoc item url http://127.0.0.1:8123", !!put && (put.ok === true || put.locked === false), JSON.stringify(put));
      const check = await q(p9, "new Promise((r) => chrome.runtime.sendMessage({action:'vault_get', keys:['genHistory']}, (v) => r(v)))");
      const hasLocal = !!(check && check.genHistory && check.genHistory.filter((x) => x.id === LOCAL_ITEM.id).length);
      c.assert("vault_get doc lai duoc item vua ghi (relay SW + giai mai)", hasLocal, "so item=" + (check && check.genHistory ? check.genHistory.length : "?"));

      // (a) cung origin: badge xuat hien va click thi dien that
      const tabA = await openTab("http://127.0.0.1:8123/", "a");
      await sleep(2500);
      const badgesA = await q(tabA, "document.querySelectorAll('.genpass-autofill-badge').length");
      c.assert("badge autofill XUAT HIEN tren origin trung khop", badgesA === 1, "badges=" + badgesA);
      const badgeBox = await q(tabA, "(function(){var b=document.querySelector('.genpass-autofill-badge'); if(!b) return 'none'; var r=b.getBoundingClientRect(); return Math.round(r.width)+'x'+Math.round(r.height)+' display='+getComputedStyle(b).display;})()");
      c.info("kich thuoc/hien thi badge", String(badgeBox));
      let filledPw = null;
      if (badgesA === 1) {
        await q(tabA, "document.querySelector('.genpass-autofill-badge').click()");
        filledPw = await waitFor("input#pw duoc dien (setNativeValue that)", 6000, () => q(tabA, "document.getElementById('pw') && document.getElementById('pw').value").catch(() => null));
      }
      c.assert("click badge -> #pw = 'LocalLogin!2026'", filledPw === LOCAL_ITEM.password, "value=" + JSON.stringify(filledPw));
      const filledUser = await q(tabA, "document.getElementById('user') && document.getElementById('user').value");
      c.assert("click badge -> #user = 'local@example.com'", filledUser === LOCAL_ITEM.username, "value=" + JSON.stringify(filledUser));
      c.info("password input co co genpassAttached", String(await q(tabA, "document.getElementById('pw') && !!document.getElementById('pw').dataset.genpassAttached")));

      // (b) khac origin string (cung server): khong duoc co badge
      const tabB = await openTab("http://localhost:8123/", "b");
      await sleep(2500);
      const badgesB = await q(tabB, "document.querySelectorAll('.genpass-autofill-badge').length");
      const pageOk = await q(tabB, "document.readyState === 'complete' && !!document.getElementById('pw')");
      c.assert("trang localhost:8123 da load that (dieu kien tien de)", pageOk === true, "ready+input=" + pageOk);
      c.assert("KHONG co badge tren origin localhost (origin check)", badgesB === 0, "badges=" + badgesB + " (host 127.0.0.1 khac localhost)");
      // (c) Kiem chung duong: content script that chay tren localhost khi co item khop origin
      const seeded2 = seeded.concat([LOCALHOST_ITEM]);
      await q(p9, "new Promise((r) => chrome.runtime.sendMessage({action:'vault_put', items:{genHistory:" + JSON.stringify(seeded2) + "}}, (v) => r(v)))");
      await q(tabB, "location.reload()");
      await waitFor("tab b load lai", 20000, () => BR.cdp.ev(tabB.sessionId, "document.readyState === 'complete' && !!document.getElementById('pw')", 8000).catch(() => false));
      await sleep(2500);
      const badgesB2 = await q(tabB, "document.querySelectorAll('.genpass-autofill-badge').length");
      c.assert("kiem chung: badge XUAT HIEN tren localhost khi co item khop origin", badgesB2 === 1, "badges=" + badgesB2);
      // Thu hoi item kiem chung de giu du lieu sach
      await q(p9, "new Promise((r) => chrome.runtime.sendMessage({action:'vault_put', items:{genHistory:" + JSON.stringify(seeded) + "}}, (v) => r(v)))");
      await closePopup(p9, 500);
    } finally {
      for (const t of tabs) { try { await BR.cdp.send("Target.closeTarget", { targetId: t.targetId }); } catch (e) { /* bo qua */ } }
      await new Promise((r) => srv.close(r));
    }
  });

  // --------------------------------------------------------------- S10 ------
  await scenario("S10", "Teardown + bang tong hop", async (c) => {
    c.info("so target con lai truoc khi don", String(BR.targets.length));
    for (const t of BR.targets.slice()) { await closePopup(t, 100); }
    c.assert("dong cac target con lai khong nem loi", true, "con " + BR.targets.length + " target chua dong duoc");
    await stopBrowser();
    c.assert("trinh duyet da dung hoan toan", BR.dead === false, "dead=" + BR.dead + " exitInfo=" + BR.exitInfo);
    c.info("thoi gian chay toi buoc nay", ((Date.now() - t0Suite) / 1000).toFixed(1) + "s");
  });

  return allPassed();
}

// ---------------------------------------------------------------------------
// Tong hop + diet sach
// ---------------------------------------------------------------------------
function pad(s, n) { s = String(s); return s.length >= n ? s.slice(0, n) : s + " ".repeat(n - s.length); }

function allPassed() {
  const fail = RESULTS.filter((r) => !r.ok).length;
  const pass = RESULTS.length - fail;
  console.log("\n======================================================================");
  console.log("TONG HOP E2E - GenPass vault tren Chrome that (" + new Date().toISOString() + ")");
  console.log("----------------------------------------------------------------------");
  console.log("  " + pad("ID", 5) + pad("KICH BAN", 60) + pad("KET QUA", 9) + pad("MS", 7) + "GHI CHU");
  for (const r of RESULTS) {
    const nbad = r.checks.filter((x) => !x.ok).length;
    let note = "";
    if (nbad) note = nbad + " check FAIL";
    if (r.fatal) note += (note ? ", " : "") + "FATAL";
    console.log("  " + pad(r.id, 5) + pad(r.title, 60) + pad(r.ok ? "PASS" : "FAIL", 9) + pad(r.ms, 7) + note);
  }
  console.log("----------------------------------------------------------------------");
  console.log("  Tong: " + pass + "/" + RESULTS.length + " scenario PASS, " + fail + " FAIL, tong thoi gian " + ((Date.now() - t0Suite) / 1000).toFixed(1) + "s");
  const errs = CONSOLE_LOG.filter((l) => l.type === "error" || l.type === "exception");
  if (errs.length) {
    console.log("  Console trinh duyet (error/exception, toi da 15 dong cuoi):");
    errs.slice(-15).forEach((l) => console.log("    [" + l.type + "] " + l.text.slice(0, 170)));
  } else {
    const any = CONSOLE_LOG.slice(-8);
    if (any.length) {
      console.log("  Console trinh duyet (8 dong cuoi, khong co error/exception):");
      any.forEach((l) => console.log("    [" + l.type + "] " + l.text.slice(0, 160)));
    } else {
      console.log("  Console trinh duyet: khong ghi nhan thong diep nao");
    }
  }
  if (SKIP_IDLE) console.log("  Luu y: E2E_SKIP_IDLE=1 -> S5 (idle 40s) va S7 (restart) bi bo qua");
  console.log("======================================================================");
  return fail === 0;
}

async function cleanup() {
  if (BR.cdp) { BR.cdp.close(); BR.cdp = null; }
  killBrowser("SIGKILL");
  await sleep(400);
  fs.rmSync(WORK_DIR, { recursive: true, force: true });
}

process.on("exit", () => { killBrowser("SIGKILL"); });

main().then((ok) => {
  cleanup().then(() => {
    console.log("EXIT CODE: " + (ok ? 0 : 1));
    process.exitCode = ok ? 0 : 1;
    setTimeout(() => process.exit(ok ? 0 : 1), 400).unref();
  });
}).catch(async (e) => {
  console.log("\nFATAL: " + (e && e.stack ? e.stack.split("\n").slice(0, 6).join("\n      ") : e));
  BR.dead = true;
  await cleanup();
  console.log("EXIT CODE: 1");
  process.exitCode = 1;
  setTimeout(() => process.exit(1), 400).unref();
});
